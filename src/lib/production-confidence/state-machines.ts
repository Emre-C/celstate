/**
 * Production confidence — state-machine transitions for coordinator and canary lifecycles.
 */

import {
	FEATURE_DOMAINS,
	type FeatureDomain,
	type Verdict,
	type CoordinatorState,
	type CoordinatorEvent,
	type CoordinatorDomainVerdict,
	type DomainLifecycleEvent,
	type GenerationCanaryState,
	type GenerationCanaryEvent,
	type CheckoutSessionCanaryState,
	type CheckoutSessionCanaryEvent,
	type LiveSettlementCanaryState,
	type LiveSettlementCanaryEvent,
} from "./types.js";

export {
	type CoordinatorState,
	type CoordinatorEvent,
	type CoordinatorDomainVerdict,
	type DomainLifecycleEvent,
	type GenerationCanaryState,
	type GenerationCanaryEvent,
	type CheckoutSessionCanaryState,
	type CheckoutSessionCanaryEvent,
	type LiveSettlementCanaryState,
	type LiveSettlementCanaryEvent,
};

// --- §6.1 Deploy verification coordinator

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
