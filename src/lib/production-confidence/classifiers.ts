/**
 * Production confidence — evidence-to-verdict classifiers.
 */

import {
	SETTLEMENT_OUTCOMES,
	type SettlementOutcome,
	type Verdict,
	type AuthCanaryEvidence,
	type CheckoutSessionCanaryEvidence,
	type LiveSettlementCanaryEvidence,
} from "./types.js";

export { SETTLEMENT_OUTCOMES, type SettlementOutcome };

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

export const classifyAuthProbeVerdict = (
	evidence: AuthCanaryEvidence,
	config: { requireProtectedRoute: boolean },
): Verdict => {
	if (!evidence.preflightProvisioningHealthy) return "FAILED";
	if (
		!evidence.authPageHealthy ||
		!evidence.sessionEndpointHealthy ||
		!evidence.clerkFapiHealthy ||
		!evidence.clerkSignInWidgetHealthy
	) {
		return "FAILED";
	}
	if (config.requireProtectedRoute && !evidence.protectedRouteReachable) return "FAILED";
	if (config.requireProtectedRoute && !evidence.convexAuthenticatedQueryHealthy) return "FAILED";
	if (config.requireProtectedRoute && !evidence.signOutHealthy) return "FAILED";
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
