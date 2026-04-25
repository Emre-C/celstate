/**
 * Production confidence — formal contract types, gate evaluation, and state machines.
 * @see docs/product/production-confidence.md
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
	readonly protectedRouteReachable: boolean;
}

export interface GenerationCanaryEvidence {
	readonly requestAccepted: boolean;
	readonly terminalVerdict: "COMPLETE" | "FAILED" | "TIMEOUT";
	readonly artifactPresent: boolean;
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

const assertGateDomainBounds = (label: keyof GateConfig, domains: readonly FeatureDomain[]) => {
	if (domains.length < 1 || domains.length > MAX_DOMAINS) {
		throw new Error(`${label} must have between 1 and ${MAX_DOMAINS} domains`);
	}
	const set = new Set(domains);
	if (set.size !== domains.length) {
		throw new Error(`${label} must have unique domains`);
	}
};

export const assertValidGateConfig = (config: GateConfig): void => {
	assertGateDomainBounds("requiredOnDeploy", config.requiredOnDeploy);
	assertGateDomainBounds("requiredOnSchedule", config.requiredOnSchedule);
	if (config.requiredOnDeploy.length > MAX_REQUIRED_DEPLOY_DOMAINS) {
		throw new Error(`requiredOnDeploy must have at most ${MAX_REQUIRED_DEPLOY_DOMAINS} domains`);
	}
};

// --- Canary principal inventory (BO2)

export interface CanaryPrincipalDefinition extends CanaryPrincipal {
	readonly email: string;
	readonly name: string;
	readonly minimumCredits: number;
}

export const CANARY_PRINCIPAL_CONFIG: Record<CanaryPrincipalId, CanaryPrincipalDefinition> = {
	CANARY_AUTH: {
		id: "CANARY_AUTH",
		proves: "AUTH",
		destructive: false,
		fundingClass: "NONE",
		email: "canary+auth@celstate.app",
		name: "Celstate Canary Auth",
		minimumCredits: 0,
	},
	CANARY_GENERATION: {
		id: "CANARY_GENERATION",
		proves: "GENERATION",
		destructive: false,
		fundingClass: "PRE_FUNDED_CREDITS",
		email: "canary+generation@celstate.app",
		name: "Celstate Canary Generation",
		minimumCredits: 1,
	},
	CANARY_CHECKOUT: {
		id: "CANARY_CHECKOUT",
		proves: "CHECKOUT_SESSION",
		destructive: false,
		fundingClass: "NONE",
		email: "canary+checkout@celstate.app",
		name: "Celstate Canary Checkout",
		minimumCredits: 0,
	},
	CANARY_SETTLEMENT: {
		id: "CANARY_SETTLEMENT",
		proves: "LIVE_SETTLEMENT",
		destructive: true,
		fundingClass: "LIVE_PAYMENT",
		email: "canary+settlement@celstate.app",
		name: "Celstate Canary Settlement",
		minimumCredits: 0,
	},
};

export const getRequiredDomainsForTrigger = (
	trigger: VerificationTrigger,
	gateConfig: GateConfig = DEFAULT_GATE_CONFIG,
): FeatureDomain[] => {
	if (trigger === "SCHEDULED") {
		return [...gateConfig.requiredOnSchedule];
	}
	return [...gateConfig.requiredOnDeploy];
};

export const getRequirementClass = (
	domain: FeatureDomain,
	trigger: VerificationTrigger,
	gateConfig: GateConfig = DEFAULT_GATE_CONFIG,
): RequirementClass => {
	if (trigger === "POST_DEPLOY" || trigger === "PRE_MERGE_CI") {
		return gateConfig.requiredOnDeploy.includes(domain) ? "REQUIRED_ON_DEPLOY" : "OPTIONAL";
	}
	return gateConfig.requiredOnSchedule.includes(domain) ? "REQUIRED_ON_SCHEDULE" : "OPTIONAL";
};

export const createRunKey = ({
	trigger,
	deploymentId,
	gitSha,
	startedAt = Date.now(),
}: {
	trigger: VerificationTrigger;
	deploymentId?: string;
	gitSha?: string;
	startedAt?: number;
}) => {
	const suffix = deploymentId?.trim() || gitSha?.trim() || new Date(startedAt).toISOString();
	return `${trigger.toLowerCase()}:${suffix}`;
};

export const createEvidenceRef = ({
	runKey,
	domain,
	startedAt,
}: {
	runKey: string;
	domain: FeatureDomain;
	startedAt: number;
}) => {
	return `${runKey}:${domain}:${startedAt}`;
};

export const isPassingVerdict = (verdict: Verdict): boolean => verdict === "PASSED";

// --- §14 Predicates

export const acceptDeploy = (
	requiredOnDeploy: readonly FeatureDomain[],
	verdictByDomain: VerdictByDomain,
): boolean =>
	requiredOnDeploy.every((d) => verdictByDomain[d] === "PASSED");

export const rejectDeploy = (
	requiredOnDeploy: readonly FeatureDomain[],
	verdictByDomain: VerdictByDomain,
): boolean =>
	requiredOnDeploy.some((d) => {
		const v = verdictByDomain[d];
		return v === "FAILED" || v === "TIMEOUT" || v === "SKIPPED";
	});

export const scheduledSystemHealthy = (
	requiredOnSchedule: readonly FeatureDomain[],
	verdictByDomain: VerdictByDomain,
): boolean =>
	requiredOnSchedule.every((d) => verdictByDomain[d] === "PASSED");

// --- Verdict aggregation

export const buildVerdictByDomain = (
	records: Iterable<DomainVerdictRecord>,
): VerdictByDomain => {
	const initial: Record<FeatureDomain, Verdict> = {
		AUTH: "PENDING",
		GENERATION: "PENDING",
		CHECKOUT_SESSION: "PENDING",
		LIVE_SETTLEMENT: "PENDING",
	};
	for (const r of records) {
		initial[r.domain] = r.verdict;
	}
	return initial;
};

export interface GateEvaluation {
	trigger: VerificationTrigger;
	releaseDecision: ReleaseDecision;
	requiredDomains: FeatureDomain[];
	missingRequiredDomains: FeatureDomain[];
	nonPassingRequiredDomains: FeatureDomain[];
	domainVerdicts: Partial<Record<FeatureDomain, Verdict>>;
}

export const evaluateReleaseDecision = ({
	trigger,
	verdicts,
	gateConfig = DEFAULT_GATE_CONFIG,
	requiredDomains: requiredDomainsOverride,
}: {
	trigger: VerificationTrigger;
	verdicts: Iterable<DomainVerdictRecord>;
	gateConfig?: GateConfig;
	requiredDomains?: readonly FeatureDomain[];
}): GateEvaluation => {
	assertValidGateConfig(gateConfig);
	const requiredDomains = [...(requiredDomainsOverride ?? getRequiredDomainsForTrigger(trigger, gateConfig))];

	const verdictMap = new Map<FeatureDomain, DomainVerdictRecord>();
	for (const v of verdicts) {
		verdictMap.set(v.domain, v);
	}

	const domainVerdicts: Partial<Record<FeatureDomain, Verdict>> = {};
	for (const domain of FEATURE_DOMAINS) {
		const rec = verdictMap.get(domain);
		if (rec) {
			domainVerdicts[domain] = rec.verdict;
		}
	}

	const missingRequiredDomains = requiredDomains.filter((domain) => !verdictMap.has(domain));
	const nonPassingRequiredDomains = requiredDomains.filter((domain) => {
		const rec = verdictMap.get(domain);
		if (rec === undefined) {
			return false;
		}
		return !isPassingVerdict(rec.verdict);
	});

	return {
		trigger,
		releaseDecision:
			missingRequiredDomains.length === 0 && nonPassingRequiredDomains.length === 0 ? "ALLOW" : "DENY",
		requiredDomains,
		missingRequiredDomains,
		nonPassingRequiredDomains,
		domainVerdicts,
	};
};

export const buildDeploymentVerificationRun = ({
	deploymentId,
	verdicts,
	startedAt,
	finishedAt,
	gateConfig = DEFAULT_GATE_CONFIG,
}: {
	deploymentId: string;
	verdicts: Iterable<DomainVerdictRecord>;
	startedAt: number;
	finishedAt?: number;
	gateConfig?: GateConfig;
}): DeploymentVerificationRun => {
	const verdictByDomain = buildVerdictByDomain(verdicts);
	const requiredOnDeploy = gateConfig.requiredOnDeploy;
	const releaseDecision: ReleaseDecision = acceptDeploy(requiredOnDeploy, verdictByDomain)
		? "ALLOW"
		: "DENY";
	return {
		deploymentId,
		trigger: "POST_DEPLOY",
		verdictByDomain,
		releaseDecision,
		startedAt,
		finishedAt,
	};
};

// --- Settlement / generation classifiers (runtime helpers)

export const SETTLEMENT_OUTCOMES = ["UNOBSERVED", "GRANTED_ONCE", "DUPLICATE_GRANT", "REFUNDED", "FAILED"] as const;
export type SettlementOutcome = (typeof SETTLEMENT_OUTCOMES)[number];

export const classifySettlementOutcome = ({
	creditGrantCount,
	revenueEventCount,
	refundedAt,
}: {
	creditGrantCount: number;
	revenueEventCount: number;
	refundedAt?: number;
}): SettlementOutcome => {
	if (creditGrantCount === 0 && revenueEventCount === 0) {
		return "UNOBSERVED";
	}
	if (creditGrantCount > 1 || revenueEventCount > 1) {
		return "DUPLICATE_GRANT";
	}
	if (creditGrantCount !== 1 || revenueEventCount !== 1) {
		return "FAILED";
	}
	if (refundedAt) {
		return "REFUNDED";
	}
	return "GRANTED_ONCE";
};

export const classifyGenerationOutcome = ({
	status,
	artifactPresent,
	resultStorageId,
}: {
	status: "generating" | "complete" | "failed";
	artifactPresent?: boolean;
	resultStorageId?: string;
}): Verdict => {
	if (status === "complete") {
		return artifactPresent || Boolean(resultStorageId) ? "PASSED" : "FAILED";
	}
	if (status === "failed") {
		return "FAILED";
	}
	return "RUNNING";
};

// --- Runner verdict classifiers (evidence → verdict, §5.3) ---

export const classifyAuthProbeVerdict = (
	evidence: AuthCanaryEvidence,
	config: { requireProtectedRoute: boolean },
): Verdict => {
	if (!evidence.authPageHealthy || !evidence.sessionEndpointHealthy) return "FAILED";
	if (config.requireProtectedRoute && !evidence.protectedRouteReachable) return "FAILED";
	return "PASSED";
};

export const classifyCheckoutProbeVerdict = (
	evidence: Pick<CheckoutSessionCanaryEvidence, "readyObserved" | "hostedCheckoutUrlPresent">,
): Verdict => {
	if (evidence.readyObserved && evidence.hostedCheckoutUrlPresent) return "PASSED";
	if (!evidence.readyObserved) return "TIMEOUT";
	return "FAILED";
};

export const classifyLiveSettlementVerdict = ({
	settlementOutcome,
	refundConfirmed,
}: {
	settlementOutcome: SettlementOutcome;
	refundConfirmed: boolean;
}): Verdict => {
	if (settlementOutcome === "GRANTED_ONCE" && refundConfirmed) return "PASSED";
	if (settlementOutcome === "DUPLICATE_GRANT" || settlementOutcome === "FAILED") return "FAILED";
	if (settlementOutcome === "UNOBSERVED") return "TIMEOUT";
	return "FAILED";
};

// --- §6.1 Deploy verification coordinator

export type CoordinatorState = "IDLE" | "RUNNING" | "PASSED" | "FAILED";

export type CoordinatorEvent = "E_START" | "E_FINALIZE_PASS" | "E_FINALIZE_FAIL" | "E_NOOP";

export type CoordinatorDomainVerdict = "ABSENT" | Verdict;

export const transitionCoordinator = (
	state: CoordinatorState,
	event: CoordinatorEvent,
	verdictByDomain: Record<FeatureDomain, CoordinatorDomainVerdict>,
	requiredOnDeploy: readonly FeatureDomain[],
): CoordinatorState => {
	if (state === "IDLE" && event === "E_START") {
		return "RUNNING";
	}
	if (state === "RUNNING" && event === "E_FINALIZE_PASS") {
		const allPassed = requiredOnDeploy.every((d) => verdictByDomain[d] === "PASSED");
		return allPassed ? "PASSED" : state;
	}
	if (state === "RUNNING" && event === "E_FINALIZE_FAIL") {
		const anyBad = requiredOnDeploy.some((d) => {
			const v = verdictByDomain[d];
			return v === "FAILED" || v === "TIMEOUT" || v === "SKIPPED";
		});
		return anyBad ? "FAILED" : state;
	}
	if (state === "PASSED" || state === "FAILED") {
		return state;
	}
	return state;
};

export type DomainLifecycleEvent =
	| "E_REQUIRE"
	| "E_BEGIN"
	| "E_PASS"
	| "E_FAIL"
	| "E_TIMEOUT"
	| "E_SKIP"
	| "E_NOOP";

export const transitionDomainVerdict = (
	verdict: CoordinatorDomainVerdict,
	event: DomainLifecycleEvent,
): CoordinatorDomainVerdict => {
	if (verdict === "ABSENT" && event === "E_REQUIRE") {
		return "PENDING";
	}
	if (verdict === "PENDING" && event === "E_BEGIN") {
		return "RUNNING";
	}
	if (verdict === "RUNNING" && event === "E_PASS") {
		return "PASSED";
	}
	if ((verdict === "PENDING" || verdict === "RUNNING") && event === "E_FAIL") {
		return "FAILED";
	}
	if ((verdict === "PENDING" || verdict === "RUNNING") && event === "E_TIMEOUT") {
		return "TIMEOUT";
	}
	if (verdict === "PENDING" && event === "E_SKIP") {
		return "SKIPPED";
	}
	if (verdict === "PASSED" || verdict === "FAILED" || verdict === "TIMEOUT" || verdict === "SKIPPED") {
		return verdict;
	}
	return verdict;
};

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

export const transitionGenerationCanary = (
	state: GenerationCanaryState,
	event: GenerationCanaryEvent,
): GenerationCanaryState => {
	if (state === "IDLE" && event === "E_REQUEST_ACCEPTED") {
		return "REQUESTED";
	}
	if (state === "REQUESTED" && event === "E_ENTER_WHITE_BACKGROUND") {
		return "WHITE_BACKGROUND";
	}
	if (state === "WHITE_BACKGROUND" && event === "E_ENTER_BLACK_BACKGROUND") {
		return "BLACK_BACKGROUND";
	}
	if (state === "BLACK_BACKGROUND" && event === "E_ENTER_FINALIZING") {
		return "FINALIZING";
	}
	if (state === "FINALIZING" && event === "E_COMPLETE") {
		return "COMPLETE";
	}
	if (
		(state === "REQUESTED" ||
			state === "WHITE_BACKGROUND" ||
			state === "BLACK_BACKGROUND" ||
			state === "FINALIZING") &&
		event === "E_FAIL"
	) {
		return "FAILED";
	}
	if (
		(state === "REQUESTED" ||
			state === "WHITE_BACKGROUND" ||
			state === "BLACK_BACKGROUND" ||
			state === "FINALIZING") &&
		event === "E_TIMEOUT"
	) {
		return "TIMEOUT";
	}
	if ((state === "FAILED" || state === "TIMEOUT") && event === "E_REFUND") {
		return "REFUNDED";
	}
	if (state === "COMPLETE" || state === "REFUNDED") {
		return state;
	}
	return state;
};

// --- §6.3 Checkout-session canary lifecycle

export type CheckoutSessionCanaryState = "IDLE" | "REQUESTED" | "PENDING" | "READY" | "FAILED" | "TIMEOUT";

export type CheckoutSessionCanaryEvent =
	| "E_REQUEST_ACCEPTED"
	| "E_PENDING_OBSERVED"
	| "E_READY_OBSERVED"
	| "E_FAIL_OBSERVED"
	| "E_TIMEOUT"
	| "E_NOOP";

export const transitionCheckoutSessionCanary = (
	state: CheckoutSessionCanaryState,
	event: CheckoutSessionCanaryEvent,
): CheckoutSessionCanaryState => {
	if (state === "IDLE" && event === "E_REQUEST_ACCEPTED") {
		return "REQUESTED";
	}
	if (state === "REQUESTED" && event === "E_PENDING_OBSERVED") {
		return "PENDING";
	}
	if (state === "REQUESTED" && event === "E_READY_OBSERVED") {
		return "READY";
	}
	if (state === "REQUESTED" && event === "E_FAIL_OBSERVED") {
		return "FAILED";
	}
	if (state === "REQUESTED" && event === "E_TIMEOUT") {
		return "TIMEOUT";
	}
	if (state === "PENDING" && event === "E_READY_OBSERVED") {
		return "READY";
	}
	if (state === "PENDING" && event === "E_FAIL_OBSERVED") {
		return "FAILED";
	}
	if (state === "PENDING" && event === "E_TIMEOUT") {
		return "TIMEOUT";
	}
	if (state === "READY" || state === "FAILED" || state === "TIMEOUT") {
		return state;
	}
	return state;
};

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

export const transitionLiveSettlementCanary = (
	state: LiveSettlementCanaryState,
	event: LiveSettlementCanaryEvent,
): LiveSettlementCanaryState => {
	if (state === "IDLE" && event === "E_SESSION_READY") {
		return "SESSION_READY";
	}
	if (state === "SESSION_READY" && event === "E_PAYMENT_COMMITTED") {
		return "PAYMENT_COMMITTED";
	}
	if (state === "PAYMENT_COMMITTED" && event === "E_PAID_WEBHOOK_OBSERVED") {
		return "PAID_WEBHOOK_OBSERVED";
	}
	if (state === "PAID_WEBHOOK_OBSERVED" && event === "E_GRANT_RECORDED") {
		return "GRANT_RECORDED";
	}
	if (state === "GRANT_RECORDED" && event === "E_REFUND_RECORDED") {
		return "REFUND_RECORDED";
	}
	if (
		(state === "SESSION_READY" ||
			state === "PAYMENT_COMMITTED" ||
			state === "PAID_WEBHOOK_OBSERVED" ||
			state === "GRANT_RECORDED") &&
		event === "E_FAIL"
	) {
		return "FAILED";
	}
	if (
		(state === "SESSION_READY" ||
			state === "PAYMENT_COMMITTED" ||
			state === "PAID_WEBHOOK_OBSERVED" ||
			state === "GRANT_RECORDED") &&
		event === "E_TIMEOUT"
	) {
		return "TIMEOUT";
	}
	if (state === "REFUND_RECORDED" || state === "FAILED" || state === "TIMEOUT") {
		return state;
	}
	return state;
};
