# Growth Observability

This document captures the implemented growth-observability system in the current product. It keeps the formal contract shape because the event taxonomy, truth classes, and verification rules are used as a precise reference for ongoing analytics work.

## 1. Scope

```text
DOCUMENT_ROLE
  machine_readable_contract_for_downstream_llm_tasks
  excludes: ui_markup, user_visible_copy, repository_path_inventory
  includes: data_contracts, process_models, verification_obligations, backlog_predicates
```

---

## 2. Enduring knowledge (predicates)

```text
K1  ∃ channel ServerChannel. authoritative(RevenueEvent, ServerChannel)
K2  ∃ channel ClientChannel. ¬guaranteed_delivery(Event, ClientChannel)
K3  first_party_ingest_domain ⇒ increased(ClientChannel_delivery_probability)
K4  ingest_filter_bot ⊂ PostHog_pipeline ⇒ reduced(noise_ratio, landing_top_of_funnel)
K5  interaction_event ⊂ ClientChannel ⇒ robustness_gt(page_view_only, funnel_signal)
K6  person_profiles_identified_only ⇒ reduced(anonymous_person_row_creation)
K7  identify(Person, PII) ⇒ obligation(data_governance_policy)
```

---

## 3. Lessons learned (implications)

```text
L1  funnel(ClientChannel_only) ⊨ undercount_wrt(ground_truth)
L2  landing_mount_event ⊨ count_per_page_load ¬= count_per_session_human
L3  autocapture_enabled ⊨ ∃ spurious_autocapture_noise
L4  oauth_start_event ⊨ count_attempts ¬= count_successes_without(ServerChannel_success)
```

---

## 4. Next steps (obligations)

```text
N1  verify(production, api_host, first_party_proxy_configuration)
N2  configure(PostHog, ingest_transformation, bot_filter_template_or_equivalent)
N3  document(metric_tier: directional_vs_authoritative_per_event_class)
N4  legal_review(consent_gate, jurisdiction_matrix) ∨ prove(not_applicable)
N5  define(internal_user_exclusion_predicate, staging_and_production_projects)
```

---

## 5. Data architecture

### 5.1 TypeScript: event taxonomy and truth class

```typescript
/** Upper bound for bounded verification models only. Not a product limit. */
declare const MAX_CLIENTS: 3;

type TruthClass = 'authoritative' | 'directional';

type ObservationSource = 'client_runtime' | 'server_runtime';

type GrowthEventSymbol =
  | 'landing_viewed'
  | 'landing_cta_clicked'
  | 'auth_sign_in_started'
  | 'signed_up'
  | 'zero_credits_prompt_shown'
  | 'credits_purchase_cta_clicked'
  | 'credits_purchase_initiated'
  | 'credits_purchase_completed';

interface EventEnvelope<T extends GrowthEventSymbol = GrowthEventSymbol> {
  readonly symbol: T;
  readonly source: ObservationSource;
  readonly truthClass: TruthClass;
}

interface LandingFunnelClient extends EventEnvelope<'landing_viewed' | 'landing_cta_clicked' | 'auth_sign_in_started'> {
  readonly source: 'client_runtime';
  readonly truthClass: 'directional';
}

interface SignupAuthoritative extends EventEnvelope<'signed_up'> {
  readonly source: 'server_runtime';
  readonly truthClass: 'authoritative';
}

interface RevenueAuthoritative extends EventEnvelope<'credits_purchase_completed'> {
  readonly source: 'server_runtime';
  readonly truthClass: 'authoritative';
}

interface CreditBridgeClient extends EventEnvelope<'zero_credits_prompt_shown' | 'credits_purchase_cta_clicked' | 'credits_purchase_initiated'> {
  readonly source: 'client_runtime';
  readonly truthClass: 'directional';
}

type GrowthEventUnion =
  | LandingFunnelClient
  | SignupAuthoritative
  | RevenueAuthoritative
  | CreditBridgeClient;
```

### 5.2 JSON Schema: ingest path configuration (abstract)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:celstate:analytics:IngestPathConfig",
  "type": "object",
  "required": ["apiHostKind"],
  "properties": {
    "apiHostKind": {
      "type": "string",
      "enum": ["third_party_regional", "first_party_proxy"]
    }
  },
  "additionalProperties": false
}
```

---

## 6. State machines

### 6.1 Client observation unit (single bounded process)

```text
MODULE ClientObservationUnit
CONSTANTS MAX_CLIENTS
ASSUME MAX_CLIENTS = 3

VARIABLES
  ustate,  \* UnitState
  inflight \* 0..1 pending outbound

UnitState ::= { idle, initialized, capture_requested, blocked, delivered, lost }

INIT
  /\ ustate = idle
  /\ inflight = 0

\* Alphabet (symbolic)
Event_init_ok
Event_init_blocked      \* key absent, blocker, policy
Event_capture
Event_transport_ack
Event_transport_fail
Event_shutdown

TRANSITIONS
  idle × Event_init_ok              → initialized
  idle × Event_init_blocked         → blocked
  idle × Event_capture              → idle
  idle × Event_transport_ack        → idle
  idle × Event_transport_fail       → idle
  idle × Event_shutdown             → idle

  initialized × Event_capture       → capture_requested
  initialized × Event_shutdown      → idle
  initialized × Event_init_ok       → initialized
  initialized × Event_init_blocked  → blocked
  initialized × Event_transport_ack → initialized
  initialized × Event_transport_fail → initialized

  capture_requested × Event_transport_ack   → delivered
  capture_requested × Event_transport_fail  → lost
  capture_requested × Event_shutdown        → lost
  capture_requested × Event_capture         → capture_requested
  capture_requested × Event_init_ok         → capture_requested
  capture_requested × Event_init_blocked    → capture_requested

  blocked × Event_init_ok           → initialized
  blocked × Event_capture           → blocked
  blocked × Event_transport_ack     → blocked
  blocked × Event_transport_fail    → blocked
  blocked × Event_shutdown          → blocked

  delivered × Event_capture         → capture_requested
  delivered × Event_init_ok         → delivered
  delivered × Event_init_blocked    → delivered
  delivered × Event_transport_ack   → delivered
  delivered × Event_transport_fail  → delivered
  delivered × Event_shutdown        → delivered

  lost × Event_init_ok              → initialized
  lost × Event_capture              → lost
  lost × Event_init_blocked         → lost
  lost × Event_transport_ack        → lost
  lost × Event_transport_fail       → lost
  lost × Event_shutdown             → lost

\* Exhaustivity: every (ustate × alphabet) row appears exactly once above.
\* Bounds: card(UnitState) < ∞; inflight ∈ {0,1} (invariant on extended model)
END MODULE
```

### 6.2 Multi-client fan-out (bounded replication, |clients| ≤ MAX_CLIENTS)

```text
MODULE ClientFanOut
EXTENDS Naturals
CONSTANTS MAX_CLIENTS
ASSUME MAX_CLIENTS ∈ Nat ∧ MAX_CLIENTS = 3

VARIABLES
  active,           \* SUBSET 1..MAX_CLIENTS
  unit_state[1..MAX_CLIENTS],  \* maps to ClientObservationUnit.UnitState
  inflight[1..MAX_CLIENTS]     \* 0..1 each

\* Interleaving: environment chooses client index ∈ active for each step
\* No shared mutable cross-client state beyond disjoint arrays

INVARIANT BoundedActive
  Cardinality(active) ≤ MAX_CLIENTS

INVARIANT DisjointInflightBounds
  ∀ i ∈ 1..MAX_CLIENTS : inflight[i] ∈ {0,1}

END MODULE
```

### 6.3 Truth reconciliation (authoritative vs directional)

```text
MODULE TruthReconciliation
VARIABLES
  rstate

ReconcileState ::= { unlinked, linked, conflict }

INIT rstate = unlinked

\* Symbolic events
E_client_signal
E_server_authoritative
E_merge
E_conflict_detected

TRANSITIONS
  unlinked × E_client_signal           → unlinked
  unlinked × E_server_authoritative    → linked
  linked × E_merge                     → linked
  linked × E_conflict_detected         → conflict
  conflict × E_merge                   → linked

\* No liveness claim at this layer without identity model parameters
END MODULE
```

---

## 7. TLA+ specification (nondeterministic delivery)

```tla
-------------------------------- MODULE AnalyticsDelivery --------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS MaxRetries
ASSUME MaxRetries ∈ Nat

VARIABLES
  queue_depth,    \* Nat, bounded in implementation by policy
  retry_count,
  delivered_flag,
  dropped_flag

Init ==
  /\ queue_depth = 0
  /\ retry_count = 0
  /\ delivered_flag = FALSE
  /\ dropped_flag = FALSE

\* Environment nondeterminism: may enqueue, may succeed send, may fail
EnvEnqueue ==
  /\ queue_depth < 5
  /\ queue_depth' = queue_depth + 1
  /\ UNCHANGED <<retry_count, delivered_flag, dropped_flag>>

SendSuccess ==
  /\ queue_depth > 0
  /\ queue_depth' = queue_depth - 1
  /\ delivered_flag' = TRUE
  /\ UNCHANGED <<retry_count, dropped_flag>>

SendFail ==
  /\ queue_depth > 0
  /\ retry_count < MaxRetries
  /\ retry_count' = retry_count + 1
  /\ UNCHANGED <<queue_depth, delivered_flag, dropped_flag>>

Abandon ==
  /\ retry_count = MaxRetries
  /\ dropped_flag' = TRUE
  /\ UNCHANGED <<queue_depth, retry_count, delivered_flag>>

Next == EnvEnqueue \/ SendSuccess \/ SendFail \/ Abandon

Spec == Init /\ [][Next]_<<queue_depth, retry_count, delivered_flag, dropped_flag>>
================================================================================
```

---

## 8. Temporal logic

### 8.1 Vocabulary

```text
p  ::= delivered_flag
q  ::= dropped_flag
r  ::= RevenueAuthoritative_observed
s  ::= (apiHostKind = first_party_proxy)
```

### 8.2 Safety invariants (LTL)

```text
□(r ⇒ ¬(truthClass(RevenueEvent) = directional))

□(¬(delivered_flag ∧ dropped_flag))   \* mutual exclusion for terminal outcome in abstract model

□(queue_depth ≤ 5)                    \* constant bound in AnalyticsDelivery abstraction
```

### 8.3 Liveness (conditional)

```text
◇(retry_count = MaxRetries) ⇒ ◇dropped_flag

\* ClientChannel liveness not asserted globally:
¬□◇delivered_flag   \* admissible: no fairness on lossy channel unless assumed
```

### 8.4 CTL obligations

```text
AG (server_emits(RevenueAuthoritative) → EF ingest_observes(RevenueAuthoritative))
\* EF quantifies over admissible PostHog pipeline branches; failure modes are environment parameters
```

---

## 9. Constraints (objective)

```text
C1  ∀ e ∈ RevenueAuthoritative. source(e) = server_runtime
C2  ∀ e ∈ LandingFunnelClient. truthClass(e) = directional
C3  ∀ deployment. verify(apiHostKind, IngestPathConfig) documented
C4  ∃ filter_bot ∈ PostHog_pipeline_components. configured(filter_bot) ∨ recorded_risk(unfiltered_bot_inflation)
```

---

## 10. Verification conditions

```text
VC1  ModelCheck(ClientObservationUnit, BoundedActive)
VC2  ModelCheck(ClientFanOut, DisjointInflightBounds)
VC3  Refinement(ImplementationEventOrder, ClientObservationUnit) ∨ gap_recorded
VC4  TypeInvariant(TruthReconciliation, rstate ∈ ReconcileState)
```

---

## 11. Symbol glossary

```text
ground_truth          database_or_payment_processor_count
directional           statistical_estimate_subject_to_loss_and_noise
authoritative         audit_grade_counterfactual_alignment_target
first_party_proxy     api_host mapped_via managed_reverse_proxy_or_equivalent
```
