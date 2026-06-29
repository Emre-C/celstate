/**
 * Production confidence — types, constants, and canary principal definitions.
 * @see docs/features/production-confidence.yaml
 */

// --- Bounded model constants (§2.3)

export const MAX_DOMAINS = 4;
export const MAX_GENERATION_STAGES = 3;
export const MAX_WEBHOOK_DELIVERIES = 3;
export const MAX_REQUIRED_DEPLOY_DOMAINS = 3;

// --- §5.1 Domain vocabulary

export const FEATURE_DOMAINS = ["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"] as const;
export type FeatureDomain = (typeof FEATURE_DOMAINS)[number];

export const VERIFICATION_TRIGGERS = ["PRE_MERGE_CI", "POST_DEPLOY", "SCHEDULED"] as const;
export type VerificationTrigger = (typeof VERIFICATION_TRIGGERS)[number];

export const VERDICTS = ["PENDING", "RUNNING", "PASSED", "FAILED", "TIMEOUT", "SKIPPED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REQUIREMENT_CLASSES = ["REQUIRED_ON_DEPLOY", "REQUIRED_ON_SCHEDULE", "OPTIONAL"] as const;
export type RequirementClass = (typeof REQUIREMENT_CLASSES)[number];

export const CANARY_PRINCIPAL_IDS = [
	"CANARY_AUTH",
	"CANARY_GENERATION",
	"CANARY_CHECKOUT",
	"CANARY_SETTLEMENT",
] as const;
export type CanaryPrincipalId = (typeof CANARY_PRINCIPAL_IDS)[number];

export const CANARY_FUNDING_CLASSES = ["NONE", "PRE_FUNDED_CREDITS", "LIVE_PAYMENT"] as const;
export type CanaryFundingClass = (typeof CANARY_FUNDING_CLASSES)[number];

export type ReleaseDecision = "ALLOW" | "DENY";

// --- §5.2 Target-state records

export type VerdictByDomain = Readonly<Record<FeatureDomain, Verdict>>;

export interface CanaryPrincipal {
	readonly id: CanaryPrincipalId;
	readonly proves: FeatureDomain;
	readonly destructive: boolean;
	readonly fundingClass: CanaryFundingClass;
}

export interface DomainVerdictRecord {
	readonly domain: FeatureDomain;
	readonly trigger: VerificationTrigger;
	readonly requirement: RequirementClass;
	readonly verdict: Verdict;
	readonly evidenceRef: string;
	readonly startedAt: number;
	readonly finishedAt?: number;
	/** Optional human-readable diagnostic note (e.g. why a verdict is SKIPPED). */
	readonly note?: string;
	/** Populated only for LIVE_SETTLEMENT verdicts; absent for other domains. */
	readonly settlementOutcome?: SettlementOutcome;
}

export interface DeploymentVerificationRun {
	readonly deploymentId: string;
	readonly trigger: "POST_DEPLOY";
	readonly verdictByDomain: VerdictByDomain;
	readonly releaseDecision: ReleaseDecision;
	readonly startedAt: number;
	readonly finishedAt?: number;
}

// --- §5.3 Evidence contracts

export interface AuthCanaryEvidence {
	readonly authPageHealthy: boolean;
	readonly sessionEndpointHealthy: boolean;
	/** Clerk custom-domain FAPI serves clerk.browser.js (DNS/TLS/script availability). */
	readonly clerkFapiHealthy: boolean;
	/** Browser renders Clerk <SignIn /> social controls (client SDK load). */
	readonly clerkSignInWidgetHealthy: boolean;
	readonly protectedRouteReachable: boolean;
	readonly convexAuthenticatedQueryHealthy: boolean;
	readonly signOutHealthy: boolean;
	/** False when canary principal provisioning fails before probes (runner still ingests). */
	readonly preflightProvisioningHealthy: boolean;
}

export interface GenerationCanaryEvidence {
	readonly requestAccepted: boolean;
	readonly terminalVerdict: "COMPLETE" | "FAILED" | "TIMEOUT";
	readonly artifactPresent: boolean;
	readonly artifactUrlIssued: boolean;
	readonly artifactDownloadReachable: boolean;
	readonly artifactDigestHeaderPresent: boolean;
	readonly artifactProbeStatus?: number;
	readonly refundObserved: boolean;
}

export interface CheckoutSessionCanaryEvidence {
	readonly requestAccepted: boolean;
	readonly pendingObserved: boolean;
	readonly readyObserved: boolean;
	readonly hostedCheckoutUrlPresent: boolean;
}

export interface LiveSettlementCanaryEvidence {
	readonly checkoutCommitted: boolean;
	readonly paidWebhookObserved: boolean;
	readonly creditGrantCount: 0 | 1;
	readonly authoritativeRevenueCount: 0 | 1;
	readonly refundObserved: boolean;
}

// --- Gate configuration (§5.5, §11.2 RP1–RP3)

export interface GateConfig {
	readonly requiredOnDeploy: readonly FeatureDomain[];
	readonly requiredOnSchedule: readonly FeatureDomain[];
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
	requiredOnDeploy: ["AUTH", "GENERATION", "CHECKOUT_SESSION"],
	requiredOnSchedule: ["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"],
};

// --- Canary principal inventory (BO2)

export interface CanaryPrincipalDefinition extends CanaryPrincipal {
	readonly email: string;
	readonly name: string;
	readonly minimumCredits: number;
}

// All four canary principals bind to the same shared QA identity
// (ycoklar@gmail.com). Users authenticate via Clerk (Google, etc.).
// canaryPrincipals rows remain distinct by principalId; they share clerkUserId
// / appUserId once the QA account has completed at least one Clerk sign-in.
const CANARY_SHARED_QA_EMAIL = "ycoklar@gmail.com" as const;

export const CANARY_PRINCIPAL_CONFIG: Record<CanaryPrincipalId, CanaryPrincipalDefinition> = {
	CANARY_AUTH: {
		id: "CANARY_AUTH",
		proves: "AUTH",
		destructive: false,
		fundingClass: "NONE",
		email: CANARY_SHARED_QA_EMAIL,
		name: "Celstate Canary Auth",
		minimumCredits: 0,
	},
	CANARY_GENERATION: {
		id: "CANARY_GENERATION",
		proves: "GENERATION",
		destructive: false,
		fundingClass: "PRE_FUNDED_CREDITS",
		email: CANARY_SHARED_QA_EMAIL,
		name: "Celstate Canary Generation",
		minimumCredits: 1,
	},
	CANARY_CHECKOUT: {
		id: "CANARY_CHECKOUT",
		proves: "CHECKOUT_SESSION",
		destructive: false,
		fundingClass: "NONE",
		email: CANARY_SHARED_QA_EMAIL,
		name: "Celstate Canary Checkout",
		minimumCredits: 0,
	},
	CANARY_SETTLEMENT: {
		id: "CANARY_SETTLEMENT",
		proves: "LIVE_SETTLEMENT",
		destructive: true,
		fundingClass: "LIVE_PAYMENT",
		email: CANARY_SHARED_QA_EMAIL,
		name: "Celstate Canary Settlement",
		minimumCredits: 0,
	},
};

// --- Settlement outcome vocabulary (forward-declared for DomainVerdictRecord)

export const SETTLEMENT_OUTCOMES = ["UNOBSERVED", "GRANTED_ONCE", "DUPLICATE_GRANT", "REFUNDED", "FAILED"] as const;
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

// --- §6.1 Deploy verification coordinator

export type CoordinatorState = "IDLE" | "RUNNING" | "PASSED" | "FAILED";
export type CoordinatorEvent = "E_START" | "E_FINALIZE_PASS" | "E_FINALIZE_FAIL" | "E_NOOP";
export type CoordinatorDomainVerdict = "ABSENT" | Verdict;

// --- §6.2 Generation canary lifecycle

export type GenerationCanaryState =
	| "IDLE"
	| "REQUESTED"
	| "WHITE_BACKGROUND"
	| "BLACK_BACKGROUND"
	| "FINALIZING"
	| "COMPLETE"
	| "FAILED"
	| "REFUNDED"
	| "TIMEOUT";

export type GenerationCanaryEvent =
	| "E_REQUEST_ACCEPTED"
	| "E_ENTER_WHITE_BACKGROUND"
	| "E_ENTER_BLACK_BACKGROUND"
	| "E_ENTER_FINALIZING"
	| "E_COMPLETE"
	| "E_FAIL"
	| "E_TIMEOUT"
	| "E_REFUND"
	| "E_NOOP";

// --- §6.3 Checkout-session canary lifecycle

export type CheckoutSessionCanaryState = "IDLE" | "REQUESTED" | "PENDING" | "READY" | "FAILED" | "TIMEOUT";

export type CheckoutSessionCanaryEvent =
	| "E_REQUEST_ACCEPTED"
	| "E_PENDING_OBSERVED"
	| "E_READY_OBSERVED"
	| "E_FAIL_OBSERVED"
	| "E_TIMEOUT"
	| "E_NOOP";

// --- §6.4 Live-settlement canary lifecycle

export type LiveSettlementCanaryState =
	| "IDLE"
	| "SESSION_READY"
	| "PAYMENT_COMMITTED"
	| "PAID_WEBHOOK_OBSERVED"
	| "GRANT_RECORDED"
	| "REFUND_RECORDED"
	| "FAILED"
	| "TIMEOUT";

export type LiveSettlementCanaryEvent =
	| "E_SESSION_READY"
	| "E_PAYMENT_COMMITTED"
	| "E_PAID_WEBHOOK_OBSERVED"
	| "E_GRANT_RECORDED"
	| "E_REFUND_RECORDED"
	| "E_FAIL"
	| "E_TIMEOUT"
	| "E_NOOP";

// --- Domain lifecycle events (shared by coordinator)

export type DomainLifecycleEvent =
	| "E_REQUIRE"
	| "E_BEGIN"
	| "E_PASS"
	| "E_FAIL"
	| "E_TIMEOUT"
	| "E_SKIP"
	| "E_NOOP";
