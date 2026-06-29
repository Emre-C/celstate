# Growth Operations Runbook

```yaml
document_id: "growth-operations-runbook"
audience: ["llm", "autonomous_coding_agent"]
human_readability: "not_required"
canonical_deps:
  - "docs/features/observability.yaml"
  - "docs/features/credits-and-payments.yaml"
  - "docs/features/image-generation.yaml"
scope:
  in: ["growth strategy", "tool access", "funnel analysis", "execution tracking"]
  out: ["UI copy", "visual design", "infrastructure ops"]
```

---

## 0. Executable tooling surface

```yaml
canonical_cli:
  readiness_check: "pnpm check:growth-tooling"
  preset_catalog: "pnpm growth:list"
  run_scaffold: "pnpm growth:scaffold -- --label <goal>"
  snapshot_phase: "pnpm growth:snapshot -- --phase P0_funnel_baseline --run-dir <dir>"
  snapshot_artifact: "pnpm growth:snapshot -- --artifact revenue_summary --run-dir <dir>"
  posthog_annotation: "pnpm growth:annotate -- --content \"<change summary>\" --run-dir <dir>"
artifacts_root: ".growth/runs/<timestamp>-<label>"
required_local_env:
  - "POSTHOG_PERSONAL_API_KEY"
  - "POSTHOG_PROJECT_ID"
optional_local_env:
  - "POSTHOG_APP_HOST"
posthog_app_host_default: "https://us.posthog.com"
```

```typescript
interface GrowthCliTooling {
  readonly id: "growth_cli";
  readonly status: "active";
  readonly capabilities: readonly [
    "readiness_check",
    "event_definition_verification",
    "hogql_snapshot_presets",
    "run_artifact_scaffolding",
    "posthog_annotation_create"
  ];
  readonly outputs_root: ".growth/runs";
}
```

### 0.1 Canonical assistant loop

1. Run `pnpm check:growth-tooling`.
2. Run `pnpm growth:scaffold -- --label <goal>` and capture the emitted run directory.
3. Run `pnpm growth:snapshot -- --phase P0_funnel_baseline --run-dir <dir>`.
4. Run additional `pnpm growth:snapshot` presets for `P1_activation_rate`, `P2_revenue_metrics`, `P3_attribution_roi`, and `P4_retention` as needed.
5. Write findings into `<dir>/assistant-brief.md` and implement the highest-leverage change in code.
6. After shipping, run `pnpm growth:annotate -- --content "<change summary>" --run-dir <dir>`.

### 0.2 Artifact contract

```typescript
interface GrowthRunArtifacts {
  readonly assistantBrief: "assistant-brief.md";
  readonly artifactsDirectory: "artifacts/*.json";
  readonly manifest: "manifest.json";
  readonly snapshotSummary: "snapshot-summary.json";
}
```

---

## 1. Product identity

```typescript
interface ProductDefinition {
  readonly name: "Celstate";
  readonly domain: "celstate.com";
  readonly appPath: "/app";
  readonly value_proposition: "transparent-background PNGs from text prompt; no post-hoc background removal";
  readonly model: "credit_pack_one_time_purchase";
  readonly auth_providers: readonly ["google"];
  readonly image_pipeline: "vertex_ai_difference_matting";
}
```

```typescript
interface PricingModel {
  readonly tiers: readonly [
    { id: "free"; price_usd: 0; credits: 3; mechanism: "signup_bonus" },
    { id: "weekly_drip"; price_usd: 0; credits: 1; mechanism: "cron_weekly" },
    { id: "starter"; price_usd: 5; credits: 15; stripe_price_id: "price_1T9zJgADZK8Hnf4rDqrfK6dF" },
    { id: "pro"; price_usd: 10; credits: 40; stripe_price_id: "price_1T9zKyADZK8Hnf4rtXt1wS8R" },
  ];
  readonly cost_per_generation: 1;
  readonly credits_expire: false;
  readonly subscription: false;
}
```

---

## 2. Tool access state machine

```typescript
type ToolId =
  | "growth_cli"
  | "posthog_mcp"
  | "stripe_mcp"
  | "vercel_api"
  | "google_search_console"
  | "codebase";

type ToolState = "not_configured" | "configured_pending_restart" | "active" | "blocked";

interface ToolAccessRecord {
  tool: ToolId;
  state: ToolState;
  auth_mechanism: string;
  capabilities: readonly string[];
  blockers: readonly string[];
}
```

```typescript
const TOOL_ACCESS_REGISTRY: readonly ToolAccessRecord[] = [
  {
    tool: "growth_cli",
    state: "active",
    auth_mechanism: "pnpm_cli_plus_posthog_personal_api_key",
    capabilities: [
      "readiness_check",
      "event_definition_verification",
      "hogql_snapshots",
      "annotation_create",
      "artifact_scaffolding",
    ],
    blockers: [],
  },
  {
    tool: "posthog_mcp",
    state: "configured_pending_restart",
    auth_mechanism: "personal_api_key_phx_bearer",
    capabilities: [
      "query_trends",
      "query_funnels",
      "query_retention",
      "query_paths",
      "hogql",
      "event_definitions_list",
      "persons_list",
      "cohorts",
      "feature_flags",
      "experiments",
      "annotations",
      "dashboards",
      "insights_crud",
      "entity_search",
    ],
    blockers: ["requires_thread_restart_to_activate"],
  },
  {
    tool: "stripe_mcp",
    state: "configured_pending_restart",
    auth_mechanism: "oauth_remote_mcp_stripe_com",
    capabilities: [
      "balance_read",
      "customers_read",
      "payment_intents_read",
      "prices_read",
      "products_read",
      "invoices_read",
      "subscriptions_read",
      "refunds_read",
      "disputes_read",
      "documentation_search",
    ],
    blockers: ["requires_thread_restart_to_activate", "oauth_consent_on_first_use"],
  },
  {
    tool: "vercel_api",
    state: "active",
    auth_mechanism: "vercel_token_env_vcp",
    capabilities: ["deployment_info", "web_analytics_if_enabled"],
    blockers: [],
  },
  {
    tool: "google_search_console",
    state: "not_configured",
    auth_mechanism: "none",
    capabilities: [],
    blockers: ["user_has_no_gsc_property"],
  },
  {
    tool: "codebase",
    state: "active",
    auth_mechanism: "workspace_fs",
    capabilities: [
      "read_write_all_source",
      "run_dev_commands",
      "edit_landing_page",
      "edit_app_routes",
      "edit_convex_backend",
      "edit_seo_metadata",
    ],
    blockers: [],
  },
] as const;
```

### 2.1 Tool activation state machine

```
stateDiagram-v2
  [*] --> not_configured
  not_configured --> configured_pending_restart : configure_mcp_settings_json
  configured_pending_restart --> active : thread_restart
  configured_pending_restart --> blocked : auth_failure
  blocked --> configured_pending_restart : reconfigure
  active --> active : tool_call_success
  active --> blocked : auth_revoked
```

### 2.2 Executable fallback for non-MCP environments

`growth_cli` is the canonical autonomous path for Celstate growth work. It satisfies:

- PostHog query readiness checks.
- Event definition verification for the core Celstate funnel.
- Repeatable HogQL snapshot generation into `.growth/runs/*`.
- PostHog annotation creation after shipping a change.

`posthog_mcp` and `stripe_mcp` remain optional accelerators. They are no longer blockers for entering `DATA_COLLECTION`.

---

## 3. MCP configuration artifact

```yaml
file: "%USERPROFILE%/.config/amp/settings.json"
mutation_date: "2026-03-26"
```

```json
{
  "amp.mcpServers": {
    "posthog": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://mcp.posthog.com/mcp",
        "--header",
        "Authorization:${POSTHOG_AUTH_HEADER}"
      ],
      "env": {
        "POSTHOG_AUTH_HEADER": "Bearer <phx_key>"
      }
    },
    "stripe": {
      "url": "https://mcp.stripe.com"
    }
  }
}
```

```typescript
interface MCPKeyInventory {
  posthog_personal_api_key: {
    prefix: "phx_";
    scope: "read_only_analytics_mcp";
    storage: "amp_settings_json_env_block";
    forbidden_for: ["event_ingestion", "client_bundle", "convex_env"];
  };
  posthog_project_key: {
    prefix: "phc_";
    scope: "event_ingestion_client_and_server";
    storage: ["vercel_env_PUBLIC_POSTHOG_KEY", "convex_env_POSTHOG_API_KEY"];
  };
  stripe_oauth: {
    mechanism: "oauth_dynamic_client_registration";
    scope: "read_via_mcp_stripe_com";
    storage: "managed_by_stripe_app";
  };
}
```

---

## 4. Growth analysis pipeline

**Canonical source of truth:** `scripts/lib/growth-runbook.ts` (`ANALYSIS_QUEUE`, `CORE_GROWTH_EVENTS`, `HYPOTHESIS_BACKLOG`) and `scripts/lib/growth-query-presets.ts` (HogQL bodies). The blocks below are a human-readable mirror; if they disagree with the repo, trust the scripts. Live catalog: `pnpm growth:list`.

### 4.1 Required queries (ordered by priority)

```typescript
type AnalysisPhase =
  | "P0_funnel_baseline"
  | "P1_activation_rate"
  | "P2_revenue_metrics"
  | "P3_attribution_roi"
  | "P4_retention";

interface AnalysisQuery {
  phase: AnalysisPhase;
  query_type: "trends" | "funnel" | "retention" | "hogql" | "stripe_read";
  description: string;
  depends_on: readonly AnalysisPhase[];
  status: "pending" | "executed" | "blocked";
  output_artifact: string;
}
```

```typescript
const ANALYSIS_QUEUE: readonly AnalysisQuery[] = [
  // --- P0: Funnel baseline ---
  {
    phase: "P0_funnel_baseline",
    query_type: "funnel",
    description: "signed_up → generation_started → generation_completed → credits_purchase_initiated → credits_purchase_completed",
    depends_on: [],
    status: "pending",
    output_artifact: "funnel_conversion_rates",
  },
  {
    phase: "P0_funnel_baseline",
    query_type: "hogql",
    description: "GH-004 landing CRO: landing_viewed, landing_cta_clicked, auth_sign_in_started, signed_up — 30d volume",
    depends_on: [],
    status: "pending",
    output_artifact: "landing_to_signup_counts",
  },
  {
    phase: "P0_funnel_baseline",
    query_type: "hogql",
    description: "GH-003 free→paid bridge: zero_credits_prompt_shown, credits_purchase_cta_clicked, credits_purchase_initiated, credits_purchase_completed — 30d",
    depends_on: [],
    status: "pending",
    output_artifact: "zero_credits_to_purchase_bridge",
  },
  {
    phase: "P0_funnel_baseline",
    query_type: "trends",
    description: "daily_signed_up_count_30d",
    depends_on: [],
    status: "pending",
    output_artifact: "signup_volume_trend",
  },
  {
    phase: "P0_funnel_baseline",
    query_type: "trends",
    description: "daily_generation_started_count_30d",
    depends_on: [],
    status: "pending",
    output_artifact: "generation_volume_trend",
  },

  // --- P1: Activation ---
  {
    phase: "P1_activation_rate",
    query_type: "hogql",
    description: "pct_users_with_at_least_one_generation_completed_within_24h_of_signup",
    depends_on: ["P0_funnel_baseline"],
    status: "pending",
    output_artifact: "activation_rate_24h",
  },
  {
    phase: "P1_activation_rate",
    query_type: "funnel",
    description: "signed_up → generation_started: time_to_convert distribution",
    depends_on: ["P0_funnel_baseline"],
    status: "pending",
    output_artifact: "time_to_first_generation",
  },

  // --- P2: Revenue ---
  {
    phase: "P2_revenue_metrics",
    query_type: "stripe_read",
    description: "total_revenue_all_time, payment_count, unique_paying_customers",
    depends_on: [],
    status: "pending",
    output_artifact: "revenue_summary",
  },
  {
    phase: "P2_revenue_metrics",
    query_type: "hogql",
    description: "credits_purchase_completed aggregated by amount_usd, grouped by user cohort (signup week)",
    depends_on: ["P0_funnel_baseline"],
    status: "pending",
    output_artifact: "revenue_by_cohort",
  },
  {
    phase: "P2_revenue_metrics",
    query_type: "trends",
    description: "credits_purchase_completed count + sum(amount_usd) over 90d",
    depends_on: [],
    status: "pending",
    output_artifact: "revenue_trend",
  },

  // --- P3: Attribution ---
  {
    phase: "P3_attribution_roi",
    query_type: "hogql",
    description: "session_attribution_registered → signed_up → credits_purchase_completed join by distinct_id, grouped by utm_source, utm_medium, referrer",
    depends_on: ["P0_funnel_baseline"],
    status: "pending",
    output_artifact: "attribution_to_revenue_map",
  },

  // --- P4: Retention ---
  {
    phase: "P4_retention",
    query_type: "retention",
    description: "weekly retention: signed_up → generation_started, 8 intervals",
    depends_on: ["P0_funnel_baseline"],
    status: "pending",
    output_artifact: "weekly_retention_curve",
  },
] as const;
```

### 4.2 Core PostHog events (`check:growth-tooling`)

`pnpm check:growth-tooling` expects PostHog **event definitions** to exist for every name in `CORE_GROWTH_EVENTS` (see `scripts/lib/growth-runbook.ts`). Current set:

- `landing_viewed`, `landing_cta_clicked`, `auth_sign_in_started` — GH-004 landing → signup measurement (client).
- `signed_up` — Convex on first user row (server).
- `generation_started`, `generation_completed`, `generation_failed` — generation pipeline (client / Convex as implemented).
- `image_downloaded`, `lottie_downloaded` — artifact download tracking, fired client-side after successful `downloadUrlAsFile` (client).
- `zero_credits_prompt_shown`, `credits_purchase_cta_clicked` — GH-003 free→paid bridge CTAs (client).
- `credits_purchase_initiated`, `credits_purchase_completed`, `credits_checkout_returned` — purchase funnel (client + Convex server for completed).
- `session_attribution_registered` — first-load attribution (client).

Typed event name constants for the app: `src/lib/analytics/growth-events.ts`.

---

## 5. Growth lever taxonomy

```typescript
type GrowthLever =
  | "seo_landing_page"
  | "onboarding_friction_reduction"
  | "activation_nudge"
  | "pricing_experiment"
  | "referral_mechanism"
  | "content_marketing"
  | "paid_acquisition"
  | "conversion_rate_optimization";

type EffortLevel = "low" | "medium" | "high";
type ImpactLevel = "low" | "medium" | "high";

interface GrowthHypothesis {
  id: string;
  lever: GrowthLever;
  hypothesis: string;
  metric_target: string;
  effort: EffortLevel;
  impact: ImpactLevel;
  prerequisite_data: readonly AnalysisPhase[];
  status: "hypothesis" | "validated" | "in_progress" | "shipped" | "rejected";
  implementation_artifact?: string;
}
```

```typescript
const HYPOTHESIS_BACKLOG: GrowthHypothesis[] = [
  {
    id: "GH-001",
    lever: "seo_landing_page",
    hypothesis: "celstate.com lacks structured SEO metadata and keyword-targeted content for high-intent queries (e.g., 'AI transparent PNG generator', 'text to transparent image')",
    metric_target: "organic_signups_per_week",
    effort: "low",
    impact: "high",
    prerequisite_data: ["P0_funnel_baseline"],
    status: "hypothesis",
  },
  {
    id: "GH-002",
    lever: "onboarding_friction_reduction",
    hypothesis: "users who sign up do not immediately understand how to generate; reducing steps to first generation increases activation",
    metric_target: "activation_rate_24h",
    effort: "medium",
    impact: "high",
    prerequisite_data: ["P1_activation_rate"],
    status: "hypothesis",
  },
  {
    id: "GH-003",
    lever: "activation_nudge",
    hypothesis: "users exhaust free credits (3) without purchasing; a well-timed prompt at credit depletion increases purchase conversion",
    metric_target: "free_to_paid_conversion_rate",
    effort: "low",
    impact: "medium",
    prerequisite_data: ["P0_funnel_baseline", "P2_revenue_metrics"],
    status: "hypothesis",
  },
  {
    id: "GH-004",
    lever: "conversion_rate_optimization",
    hypothesis: "landing page → signup conversion is below industry benchmark for creative tools (5-10%); CRO on hero section increases signups",
    metric_target: "landing_to_signup_rate",
    effort: "medium",
    impact: "high",
    prerequisite_data: ["P0_funnel_baseline"],
    status: "hypothesis",
  },
  {
    id: "GH-005",
    lever: "pricing_experiment",
    hypothesis: "starter pack ($5/15cr) underperforms; a lower entry point ($3/10cr) or higher value ($5/25cr) improves purchase rate",
    metric_target: "purchase_rate_per_signup",
    effort: "low",
    impact: "medium",
    prerequisite_data: ["P2_revenue_metrics"],
    status: "hypothesis",
  },
  {
    id: "GH-006",
    lever: "referral_mechanism",
    hypothesis: "no referral system exists; adding share-for-credits increases organic acquisition at near-zero CAC",
    metric_target: "referred_signups_per_week",
    effort: "high",
    impact: "medium",
    prerequisite_data: ["P0_funnel_baseline", "P4_retention"],
    status: "hypothesis",
  },
];
```

---

## 6. Execution state machine (TLA+)

```typescript
interface ExecutionState {
  current_phase: "TOOL_SETUP" | "DATA_COLLECTION" | "ANALYSIS" | "HYPOTHESIS_VALIDATION" | "PRIORITIZATION" | "IMPLEMENTATION" | "MEASUREMENT";
  tools_active: readonly ToolId[];
  queries_executed: readonly string[];
  hypotheses_validated: readonly string[];
  changes_shipped: readonly string[];
  blockers: readonly string[];
}
```

```typescript
const CURRENT_STATE: ExecutionState = {
  current_phase: "DATA_COLLECTION",
  tools_active: ["codebase", "vercel_api", "growth_cli"],
  queries_executed: [],
  hypotheses_validated: [],
  changes_shipped: [],
  blockers: ["stripe_mcp: optional_for_live_stripe_object_reads_only"],
};
```

```tla+
---- MODULE GrowthExecution ----
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS
  MAX_HYPOTHESES,   \* = 6 (cardinality of HYPOTHESIS_BACKLOG)
  MAX_ITERATIONS,   \* = 3 (bound on measurement→implementation cycles per hypothesis)
  TOOLS             \* = {"growth_cli", "posthog_mcp", "stripe_mcp", "vercel_api", "codebase"}

VARIABLES
  phase,            \* ∈ Phase
  tools_active,     \* ⊆ TOOLS
  p0_executed,      \* BOOLEAN
  hypotheses_valid, \* ⊆ 1..MAX_HYPOTHESES
  selected,         \* ∈ (1..MAX_HYPOTHESES) ∪ {0}
  shipped,          \* ⊆ 1..MAX_HYPOTHESES
  iter_count,       \* ∈ 0..MAX_ITERATIONS
  user_approved     \* BOOLEAN

vars == <<phase, tools_active, p0_executed, hypotheses_valid, selected, shipped, iter_count, user_approved>>

Phase == {"TOOL_SETUP", "DATA_COLLECTION", "ANALYSIS",
          "HYPOTHESIS_VALIDATION", "PRIORITIZATION",
          "IMPLEMENTATION", "MEASUREMENT"}

RequiredTools == {"growth_cli"}

TypeInvariant ==
  /\ phase \in Phase
  /\ tools_active \subseteq TOOLS
  /\ p0_executed \in BOOLEAN
  /\ hypotheses_valid \subseteq 1..MAX_HYPOTHESES
  /\ selected \in (1..MAX_HYPOTHESES) \union {0}
  /\ shipped \subseteq 1..MAX_HYPOTHESES
  /\ iter_count \in 0..MAX_ITERATIONS
  /\ user_approved \in BOOLEAN

Init ==
  /\ phase = "DATA_COLLECTION"
  /\ tools_active = {"growth_cli", "vercel_api", "codebase"}
  /\ p0_executed = FALSE
  /\ hypotheses_valid = {}
  /\ selected = 0
  /\ shipped = {}
  /\ iter_count = 0
  /\ user_approved = FALSE

\* --- Transitions ---

ActivateTool(t) ==
  /\ phase = "TOOL_SETUP"
  /\ t \in TOOLS \ tools_active
  /\ tools_active' = tools_active \union {t}
  /\ IF RequiredTools \subseteq (tools_active \union {t})
     THEN phase' = "DATA_COLLECTION"
     ELSE phase' = "TOOL_SETUP"
  /\ UNCHANGED <<p0_executed, hypotheses_valid, selected, shipped, iter_count, user_approved>>

ExecuteP0 ==
  /\ phase = "DATA_COLLECTION"
  /\ ~p0_executed
  /\ p0_executed' = TRUE
  /\ phase' = "ANALYSIS"
  /\ UNCHANGED <<tools_active, hypotheses_valid, selected, shipped, iter_count, user_approved>>

ValidateHypothesis(h) ==
  /\ phase \in {"ANALYSIS", "HYPOTHESIS_VALIDATION"}
  /\ h \in 1..MAX_HYPOTHESES
  /\ h \notin hypotheses_valid
  /\ p0_executed
  /\ hypotheses_valid' = hypotheses_valid \union {h}
  /\ phase' = "HYPOTHESIS_VALIDATION"
  /\ UNCHANGED <<tools_active, p0_executed, selected, shipped, iter_count, user_approved>>

Prioritize ==
  /\ phase = "HYPOTHESIS_VALIDATION"
  /\ hypotheses_valid /= {}
  /\ phase' = "PRIORITIZATION"
  /\ UNCHANGED <<tools_active, p0_executed, hypotheses_valid, selected, shipped, iter_count, user_approved>>

SelectLever(h) ==
  /\ phase = "PRIORITIZATION"
  /\ h \in hypotheses_valid
  /\ h \notin shipped
  /\ user_approved' = TRUE
  /\ selected' = h
  /\ phase' = "IMPLEMENTATION"
  /\ iter_count' = 0
  /\ UNCHANGED <<tools_active, p0_executed, hypotheses_valid, shipped>>

Ship ==
  /\ phase = "IMPLEMENTATION"
  /\ selected /= 0
  /\ phase' = "MEASUREMENT"
  /\ UNCHANGED <<tools_active, p0_executed, hypotheses_valid, selected, shipped, iter_count, user_approved>>

MeasureAndIterate ==
  /\ phase = "MEASUREMENT"
  /\ iter_count < MAX_ITERATIONS
  /\ iter_count' = iter_count + 1
  /\ phase' = "IMPLEMENTATION"
  /\ UNCHANGED <<tools_active, p0_executed, hypotheses_valid, selected, shipped, user_approved>>

MeasureAndAdvance ==
  /\ phase = "MEASUREMENT"
  /\ shipped' = shipped \union {selected}
  /\ selected' = 0
  /\ user_approved' = FALSE
  /\ iter_count' = 0
  /\ IF hypotheses_valid \ (shipped \union {selected}) /= {}
     THEN phase' = "HYPOTHESIS_VALIDATION"
     ELSE phase' = "HYPOTHESIS_VALIDATION"  \* terminal re-entry; Terminated detects completion
  /\ UNCHANGED <<tools_active, p0_executed, hypotheses_valid>>

Next ==
  \/ \E t \in TOOLS: ActivateTool(t)
  \/ ExecuteP0
  \/ \E h \in 1..MAX_HYPOTHESES: ValidateHypothesis(h)
  \/ Prioritize
  \/ \E h \in 1..MAX_HYPOTHESES: SelectLever(h)
  \/ Ship
  \/ MeasureAndIterate
  \/ MeasureAndAdvance

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

\* --- Invariants ---

NoShipWithoutApproval ==
  phase = "IMPLEMENTATION" => user_approved

NoAnalysisWithoutP0 ==
  phase \in {"ANALYSIS", "HYPOTHESIS_VALIDATION", "PRIORITIZATION"} => p0_executed

NoMeasurementWithoutSelection ==
  phase = "MEASUREMENT" => selected /= 0

IterationBound ==
  iter_count <= MAX_ITERATIONS

MonotonicShipped ==
  [][shipped \subseteq shipped']_vars

\* --- Liveness ---

ToolsEventuallyActive ==
  <>(RequiredTools \subseteq tools_active)

P0EventuallyExecuted ==
  <>(p0_executed)

EventuallyOneShipped ==
  <>(shipped /= {})

====
```

---

## 7. Temporal logic — safety invariants

```
□(phase = "IMPLEMENTATION" → user_approved = TRUE)
□(phase ∈ {"ANALYSIS", "HYPOTHESIS_VALIDATION", "PRIORITIZATION"} → p0_executed = TRUE)
□(phase = "MEASUREMENT" → selected ≠ 0)
□(iter_count ≤ MAX_ITERATIONS)
□(shipped ⊆ shipped')                                          \* monotonicity
□(¬∃ artifact: artifact.contains(phx_key) ∧ artifact ≠ amp_settings_json)
□(∀ mutation ∈ {stripe_price_update, feature_flag_toggle}: mutation.requires_user_consent = TRUE)
□(∀ event ∈ revenue_decisions: event.source = "server_side")    \* client_events_are_lossy
□(landing_page.content(crawler) = landing_page.content(user))   \* no cloaking
```

---

## 8. Temporal logic — liveness guarantees

```
◇(RequiredTools ⊆ tools_active)                                \* tools eventually activate
◇(p0_executed)                                                  \* baseline data eventually collected
◇(hypotheses_valid ≠ ∅)                                        \* at least one hypothesis validated
◇(shipped ≠ ∅)                                                 \* at least one change shipped
◇(phase = "MEASUREMENT")                                       \* pipeline reaches measurement
∀ h ∈ hypotheses_valid: ◇(h ∈ shipped ∨ h.status = "rejected") \* no hypothesis stuck forever
□(phase = "TOOL_SETUP" ∧ blocker → ◇(blocker_resolved))        \* blocked tools eventually unblock
```

---

## 9. Fairness constraints

```
WF(ActivateTool)      \* tool activation not starved
WF(ExecuteP0)         \* data collection not starved
WF(MeasureAndAdvance) \* measurement cycle terminates
SF(SelectLever)       \* prioritization eventually selects (strong fairness: prevents indefinite deferral)
```

---

## 10. Transition conditions

```typescript
interface TransitionGuard {
  from: ExecutionState["current_phase"];
  to: ExecutionState["current_phase"];
  guard: string;
}

const TRANSITIONS: readonly TransitionGuard[] = [
  {
    from: "TOOL_SETUP",
    to: "DATA_COLLECTION",
    guard: "growth_cli.state === 'active'",
  },
  {
    from: "DATA_COLLECTION",
    to: "ANALYSIS",
    guard: "ANALYSIS_QUEUE.filter(q => q.phase === 'P0_funnel_baseline').every(q => q.status === 'executed')",
  },
  {
    from: "ANALYSIS",
    to: "HYPOTHESIS_VALIDATION",
    guard: "funnel_conversion_rates ≠ ∅ ∧ signup_volume_trend ≠ ∅",
  },
  {
    from: "HYPOTHESIS_VALIDATION",
    to: "PRIORITIZATION",
    guard: "∃ h ∈ HYPOTHESIS_BACKLOG: h.status === 'validated'",
  },
  {
    from: "PRIORITIZATION",
    to: "IMPLEMENTATION",
    guard: "selected_lever ≠ null ∧ user_approval === true",
  },
  {
    from: "IMPLEMENTATION",
    to: "MEASUREMENT",
    guard: "change_deployed ∧ posthog_annotation_created",
  },
  {
    from: "MEASUREMENT",
    to: "HYPOTHESIS_VALIDATION",
    guard: "measurement_window_elapsed ∧ statistical_significance_reached",
  },
] as const;
```

---

## 11. Completion checklist

```typescript
type ChecklistItem = {
  id: string;
  description: string;
  done: boolean;
  blocked_by?: string;
};

const CHECKLIST: ChecklistItem[] = [
  // --- Tool setup ---
  { id: "T-001", description: "Growth CLI is present in package.json (`check:growth-tooling`, `growth:scaffold`, `growth:snapshot`, `growth:annotate`)", done: true },
  { id: "T-002", description: "POSTHOG_PERSONAL_API_KEY configured locally with Query Read, event definition read, and annotation write scopes", done: false, blocked_by: "user_action" },
  { id: "T-003", description: "POSTHOG_PROJECT_ID configured locally", done: false, blocked_by: "user_action" },
  { id: "T-004", description: "Growth readiness verified via `pnpm check:growth-tooling`", done: false, blocked_by: "T-002" },
  { id: "T-005", description: "Growth run scaffolded via `pnpm growth:scaffold -- --label <goal>`", done: false, blocked_by: "T-004" },
  { id: "T-006", description: "P0 baseline snapshot captured via `pnpm growth:snapshot -- --phase P0_funnel_baseline --run-dir <dir>`", done: false, blocked_by: "T-005" },

  // --- Data collection ---
  { id: "D-001", description: "P0 funnel baseline queries executed", done: false, blocked_by: "T-006" },
  { id: "D-002", description: "P1 activation rate queries executed", done: false, blocked_by: "D-001" },
  { id: "D-003", description: "P2 revenue metrics queries executed", done: false, blocked_by: "D-001" },
  { id: "D-004", description: "P3 attribution queries executed", done: false, blocked_by: "D-001" },
  { id: "D-005", description: "P4 retention queries executed", done: false, blocked_by: "D-001" },

  // --- Analysis ---
  { id: "A-001", description: "Bottleneck identified (largest funnel drop-off)", done: false, blocked_by: "D-001" },
  { id: "A-002", description: "Hypotheses scored (effort × impact matrix)", done: false, blocked_by: "A-001" },
  { id: "A-003", description: "Top growth lever selected with user approval", done: false, blocked_by: "A-002" },

  // --- Execution ---
  { id: "E-001", description: "First growth change implemented", done: false, blocked_by: "A-003" },
  { id: "E-002", description: "PostHog annotation created for change", done: false, blocked_by: "E-001" },
  { id: "E-003", description: "Measurement window defined and tracking", done: false, blocked_by: "E-002" },
];
```

---

## 12. File references

```yaml
this_document: "docs/runbooks/GROWTH-OPERATIONS.md"
observability_spec: "docs/features/observability.yaml"
payments_spec: "docs/features/credits-and-payments.yaml"
image_generation_spec: "docs/features/image-generation.yaml"
design_system: "docs/product/design-system.md"
growth_workflow: ".windsurf/workflows/growth-operations.md"
growth_cli: "scripts/growth-ops.ts"
growth_query_presets: "scripts/lib/growth-query-presets.ts"
growth_posthog_api: "scripts/lib/posthog-api.ts"
growth_artifacts_root: ".growth/runs/"
amp_settings: "%USERPROFILE%/.config/amp/settings.json"
landing_page: "src/routes/(marketing)/+page.svelte"
app_layout: "src/routes/(app)/app/+layout.svelte"
app_page: "src/routes/(app)/app/+page.svelte"
posthog_client: "src/lib/posthog.ts"
session_attribution: "src/lib/analytics/session-attribution.ts"
stripe_webhook: "src/convex/http.ts"
```
