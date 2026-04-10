import { describe, expect, it } from "vitest";
import {
	CANARY_PRINCIPAL_CONFIG,
	CANARY_PRINCIPAL_IDS,
	DEFAULT_GATE_CONFIG,
	FEATURE_DOMAINS,
	PROBE_OUTCOMES,
	acceptDeploy,
	assertValidGateConfig,
	buildDeploymentVerificationRun,
	buildVerdictByDomain,
	classifyAuthProbeVerdict,
	classifyCheckoutProbeVerdict,
	classifyGenerationOutcome,
	classifyLiveSettlementVerdict,
	classifySettlementOutcome,
	evaluateReleaseDecision,
	getRequirementClass,
	rejectDeploy,
	scheduledSystemHealthy,
	transitionCheckoutSessionCanary,
	transitionCoordinator,
	transitionDomainVerdict,
	transitionGenerationCanary,
	transitionLiveSettlementCanary,
	type AuthCanaryEvidence,
	type CheckoutSessionCanaryEvidence,
	type CoordinatorDomainVerdict,
	type DomainVerdictRecord,
	type GenerationCanaryEvidence,
	type LiveSettlementCanaryEvidence,
} from "./production-confidence.js";

const req = (domain: DomainVerdictRecord["domain"], verdict: DomainVerdictRecord["verdict"]): DomainVerdictRecord => ({
	domain,
	trigger: "POST_DEPLOY",
	requirement: "REQUIRED_ON_DEPLOY",
	verdict,
	evidenceRef: domain,
	startedAt: 1,
	finishedAt: 2,
});

describe("production confidence gate evaluation", () => {
	it("requires all post-deploy required domains to pass", () => {
		const verdicts: DomainVerdictRecord[] = [
			req("AUTH", "PASSED"),
			{ ...req("GENERATION", "FAILED"), evidenceRef: "generation" },
			req("CHECKOUT_SESSION", "PASSED"),
		];

		const evaluation = evaluateReleaseDecision({ trigger: "POST_DEPLOY", verdicts });

		expect(evaluation.releaseDecision).toBe("DENY");
		expect(evaluation.nonPassingRequiredDomains).toEqual(["GENERATION"]);
		expect(evaluation.missingRequiredDomains).toEqual([]);
	});

	it("denies release when a required domain is missing", () => {
		const verdicts: DomainVerdictRecord[] = [req("AUTH", "PASSED"), req("GENERATION", "PASSED")];

		const evaluation = evaluateReleaseDecision({ trigger: "POST_DEPLOY", verdicts });

		expect(evaluation.releaseDecision).toBe("DENY");
		expect(evaluation.missingRequiredDomains).toEqual(["CHECKOUT_SESSION"]);
	});

	it("is total over all fully-populated post-deploy outcome vectors", () => {
		const requiredDomains = FEATURE_DOMAINS.filter(
			(domain) => getRequirementClass(domain, "POST_DEPLOY") === "REQUIRED_ON_DEPLOY",
		);
		const requiredOutcomes = PROBE_OUTCOMES;
		let totalVectors = 0;
		let allowedVectors = 0;

		for (const authOutcome of requiredOutcomes) {
			for (const generationOutcome of requiredOutcomes) {
				for (const checkoutOutcome of requiredOutcomes) {
					totalVectors += 1;
					const evaluation = evaluateReleaseDecision({
						trigger: "POST_DEPLOY",
						verdicts: [
							{ ...req(requiredDomains[0]!, authOutcome), evidenceRef: "auth" },
							{ ...req(requiredDomains[1]!, generationOutcome), evidenceRef: "generation" },
							{ ...req(requiredDomains[2]!, checkoutOutcome), evidenceRef: "checkout" },
						],
					});
					expect(["ALLOW", "DENY"]).toContain(evaluation.releaseDecision);
					if (evaluation.releaseDecision === "ALLOW") {
						allowedVectors += 1;
						expect(authOutcome).toBe("PASSED");
						expect(generationOutcome).toBe("PASSED");
						expect(checkoutOutcome).toBe("PASSED");
					}
				}
			}
		}

		expect(totalVectors).toBe(requiredOutcomes.length ** 3);
		expect(allowedVectors).toBe(1);
	});

	it("buildDeploymentVerificationRun matches acceptDeploy predicate", () => {
		const verdicts: DomainVerdictRecord[] = [
			req("AUTH", "PASSED"),
			req("GENERATION", "PASSED"),
			req("CHECKOUT_SESSION", "PASSED"),
		];
		const run = buildDeploymentVerificationRun({
			deploymentId: "d1",
			verdicts,
			startedAt: 1,
			finishedAt: 2,
		});
		expect(run.releaseDecision).toBe("ALLOW");
		expect(acceptDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], run.verdictByDomain)).toBe(true);
		expect(rejectDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], run.verdictByDomain)).toBe(false);
	});

	it("scheduledSystemHealthy uses requiredOnSchedule domains", () => {
		const v = buildVerdictByDomain([
			req("AUTH", "PASSED"),
			req("GENERATION", "PASSED"),
			req("CHECKOUT_SESSION", "PASSED"),
			{ ...req("LIVE_SETTLEMENT", "PASSED"), trigger: "SCHEDULED", requirement: "REQUIRED_ON_SCHEDULE" },
		]);
		expect(
			scheduledSystemHealthy(
				["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"],
				v,
			),
		).toBe(true);
	});
});

describe("production confidence settlement classification", () => {
	it("classifies exact-once observed settlement", () => {
		expect(classifySettlementOutcome({ creditGrantCount: 1, revenueEventCount: 1 })).toBe(
			"GRANTED_ONCE",
		);
	});

	it("classifies refunded settlement separately", () => {
		expect(
			classifySettlementOutcome({ creditGrantCount: 1, revenueEventCount: 1, refundedAt: Date.now() }),
		).toBe("REFUNDED");
	});

	it("classifies missing or duplicate settlement effects", () => {
		expect(classifySettlementOutcome({ creditGrantCount: 0, revenueEventCount: 0 })).toBe("UNOBSERVED");
		expect(classifySettlementOutcome({ creditGrantCount: 2, revenueEventCount: 1 })).toBe(
			"DUPLICATE_GRANT",
		);
		expect(classifySettlementOutcome({ creditGrantCount: 1, revenueEventCount: 0 })).toBe("FAILED");
	});
});

describe("production confidence generation classification", () => {
	it("requires successful generations to produce an artifact", () => {
		expect(classifyGenerationOutcome({ status: "complete", resultStorageId: "storage_123" })).toBe(
			"PASSED",
		);
		expect(classifyGenerationOutcome({ status: "complete" })).toBe("FAILED");
	});

	it("treats any terminal failure as failing and in-flight work as running", () => {
		expect(classifyGenerationOutcome({ status: "failed", artifactPresent: false })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "failed" })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "generating" })).toBe("RUNNING");
	});
});

describe("deploy verification coordinator (§6.1)", () => {
	it("finalizes pass only when all required domains passed", () => {
		const verdicts: Record<(typeof FEATURE_DOMAINS)[number], CoordinatorDomainVerdict> = {
			AUTH: "PASSED",
			GENERATION: "PASSED",
			CHECKOUT_SESSION: "PASSED",
			LIVE_SETTLEMENT: "PENDING",
		};
		let s = transitionCoordinator("IDLE", "E_START", verdicts, ["AUTH", "GENERATION", "CHECKOUT_SESSION"]);
		expect(s).toBe("RUNNING");
		s = transitionCoordinator(s, "E_FINALIZE_PASS", verdicts, ["AUTH", "GENERATION", "CHECKOUT_SESSION"]);
		expect(s).toBe("PASSED");
	});

	it("finalizes fail when any required domain is terminal bad", () => {
		const verdicts = {
			AUTH: "FAILED",
			GENERATION: "PASSED",
			CHECKOUT_SESSION: "PASSED",
			LIVE_SETTLEMENT: "PENDING",
		} as const;
		let s = transitionCoordinator("IDLE", "E_START", verdicts, ["AUTH", "GENERATION", "CHECKOUT_SESSION"]);
		s = transitionCoordinator(s, "E_FINALIZE_FAIL", verdicts, ["AUTH", "GENERATION", "CHECKOUT_SESSION"]);
		expect(s).toBe("FAILED");
	});
});

describe("domain verdict transitions (§6.1 δd)", () => {
	it("covers require → pending → running → passed", () => {
		let v = transitionDomainVerdict("ABSENT", "E_REQUIRE");
		expect(v).toBe("PENDING");
		v = transitionDomainVerdict(v, "E_BEGIN");
		expect(v).toBe("RUNNING");
		v = transitionDomainVerdict(v, "E_PASS");
		expect(v).toBe("PASSED");
	});
});

describe("generation canary lifecycle (§6.2)", () => {
	it("reaches COMPLETE on happy path", () => {
		let s = transitionGenerationCanary("IDLE", "E_REQUEST_ACCEPTED");
		s = transitionGenerationCanary(s, "E_ENTER_WHITE_BACKGROUND");
		s = transitionGenerationCanary(s, "E_ENTER_BLACK_BACKGROUND");
		s = transitionGenerationCanary(s, "E_ENTER_FINALIZING");
		s = transitionGenerationCanary(s, "E_COMPLETE");
		expect(s).toBe("COMPLETE");
	});
});

describe("checkout-session canary lifecycle (§6.3)", () => {
	it("reaches READY from PENDING", () => {
		let s = transitionCheckoutSessionCanary("IDLE", "E_REQUEST_ACCEPTED");
		s = transitionCheckoutSessionCanary(s, "E_PENDING_OBSERVED");
		s = transitionCheckoutSessionCanary(s, "E_READY_OBSERVED");
		expect(s).toBe("READY");
	});
});

describe("live-settlement canary lifecycle (§6.4)", () => {
	it("reaches GRANT_RECORDED", () => {
		let s = transitionLiveSettlementCanary("IDLE", "E_SESSION_READY");
		s = transitionLiveSettlementCanary(s, "E_PAYMENT_COMMITTED");
		s = transitionLiveSettlementCanary(s, "E_PAID_WEBHOOK_OBSERVED");
		s = transitionLiveSettlementCanary(s, "E_GRANT_RECORDED");
		expect(s).toBe("GRANT_RECORDED");
	});
});

// ─── Runner verdict classifiers ────────────────────────────────────────

describe("classifyAuthProbeVerdict", () => {
	it("passes when all smoke probes healthy and protected route not required", () => {
		expect(
			classifyAuthProbeVerdict(
				{ authPageHealthy: true, sessionEndpointHealthy: true, protectedRouteReachable: false },
				{ requireProtectedRoute: false },
			),
		).toBe("PASSED");
	});

	it("passes when protected route required and reachable", () => {
		expect(
			classifyAuthProbeVerdict(
				{ authPageHealthy: true, sessionEndpointHealthy: true, protectedRouteReachable: true },
				{ requireProtectedRoute: true },
			),
		).toBe("PASSED");
	});

	it("fails when protected route required but not reachable (redirect to /auth)", () => {
		expect(
			classifyAuthProbeVerdict(
				{ authPageHealthy: true, sessionEndpointHealthy: true, protectedRouteReachable: false },
				{ requireProtectedRoute: true },
			),
		).toBe("FAILED");
	});

	it("fails when auth page is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(
				{ authPageHealthy: false, sessionEndpointHealthy: true, protectedRouteReachable: false },
				{ requireProtectedRoute: false },
			),
		).toBe("FAILED");
	});

	it("fails when session endpoint is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(
				{ authPageHealthy: true, sessionEndpointHealthy: false, protectedRouteReachable: false },
				{ requireProtectedRoute: false },
			),
		).toBe("FAILED");
	});
});

describe("classifyCheckoutProbeVerdict", () => {
	it("passes when ready with a valid hosted checkout URL", () => {
		expect(
			classifyCheckoutProbeVerdict({ readyObserved: true, hostedCheckoutUrlPresent: true }),
		).toBe("PASSED");
	});

	it("times out when ready was never observed", () => {
		expect(
			classifyCheckoutProbeVerdict({ readyObserved: false, hostedCheckoutUrlPresent: false }),
		).toBe("TIMEOUT");
	});

	it("fails when ready but no hosted checkout URL", () => {
		expect(
			classifyCheckoutProbeVerdict({ readyObserved: true, hostedCheckoutUrlPresent: false }),
		).toBe("FAILED");
	});
});

describe("classifyGenerationOutcome — negative paths", () => {
	it("fails a completed generation with no artifact (resultStorageId missing)", () => {
		expect(classifyGenerationOutcome({ status: "complete" })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "complete", resultStorageId: undefined })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "complete", artifactPresent: false })).toBe("FAILED");
	});

	it("fails a failed generation regardless of refund (§EK10)", () => {
		// A compensating refund is a recovery action, not evidence of pipeline success
		expect(classifyGenerationOutcome({ status: "failed" })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "failed", artifactPresent: false })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "failed", resultStorageId: "storage_123" })).toBe("FAILED");
	});

	it("passes only when complete with artifact evidence", () => {
		expect(classifyGenerationOutcome({ status: "complete", resultStorageId: "storage_123" })).toBe("PASSED");
		expect(classifyGenerationOutcome({ status: "complete", artifactPresent: true })).toBe("PASSED");
	});

	it("returns RUNNING for in-flight generations", () => {
		expect(classifyGenerationOutcome({ status: "generating" })).toBe("RUNNING");
	});
});

describe("classifyLiveSettlementVerdict", () => {
	it("passes only when granted once AND refund confirmed", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "GRANTED_ONCE", refundConfirmed: true }),
		).toBe("PASSED");
	});

	it("fails when granted once but refund not confirmed", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "GRANTED_ONCE", refundConfirmed: false }),
		).toBe("FAILED");
	});

	it("fails on duplicate grant (ledger integrity issue)", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "DUPLICATE_GRANT", refundConfirmed: true }),
		).toBe("FAILED");
	});

	it("fails on settlement FAILED classification", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "FAILED", refundConfirmed: false }),
		).toBe("FAILED");
	});

	it("times out when settlement was never observed", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "UNOBSERVED", refundConfirmed: false }),
		).toBe("TIMEOUT");
	});

	it("fails on already-refunded settlement (unexpected pre-existing state)", () => {
		expect(
			classifyLiveSettlementVerdict({ settlementOutcome: "REFUNDED", refundConfirmed: true }),
		).toBe("FAILED");
	});
});

// ─── Gate configuration invariants ─────────────────────────────────────

describe("gate configuration invariants", () => {
	it("DEFAULT_GATE_CONFIG requires LIVE_SETTLEMENT on SCHEDULED trigger", () => {
		expect(DEFAULT_GATE_CONFIG.requiredOnSchedule).toContain("LIVE_SETTLEMENT");
	});

	it("DEFAULT_GATE_CONFIG requires AUTH, GENERATION, CHECKOUT_SESSION on deploy", () => {
		expect(DEFAULT_GATE_CONFIG.requiredOnDeploy).toContain("AUTH");
		expect(DEFAULT_GATE_CONFIG.requiredOnDeploy).toContain("GENERATION");
		expect(DEFAULT_GATE_CONFIG.requiredOnDeploy).toContain("CHECKOUT_SESSION");
	});

	it("SCHEDULED trigger with SKIPPED LIVE_SETTLEMENT must DENY", () => {
		const verdicts: DomainVerdictRecord[] = [
			req("AUTH", "PASSED"),
			req("GENERATION", "PASSED"),
			req("CHECKOUT_SESSION", "PASSED"),
			{ ...req("LIVE_SETTLEMENT", "SKIPPED"), trigger: "SCHEDULED", requirement: "REQUIRED_ON_SCHEDULE" },
		];
		const evaluation = evaluateReleaseDecision({ trigger: "SCHEDULED", verdicts });
		expect(evaluation.releaseDecision).toBe("DENY");
		expect(evaluation.nonPassingRequiredDomains).toContain("LIVE_SETTLEMENT");
	});

	it("SCHEDULED trigger with missing LIVE_SETTLEMENT must DENY", () => {
		const verdicts: DomainVerdictRecord[] = [
			req("AUTH", "PASSED"),
			req("GENERATION", "PASSED"),
			req("CHECKOUT_SESSION", "PASSED"),
		];
		const evaluation = evaluateReleaseDecision({ trigger: "SCHEDULED", verdicts });
		expect(evaluation.releaseDecision).toBe("DENY");
		expect(evaluation.missingRequiredDomains).toContain("LIVE_SETTLEMENT");
	});

	it("POST_DEPLOY trigger allows SKIPPED LIVE_SETTLEMENT", () => {
		const verdicts: DomainVerdictRecord[] = [
			req("AUTH", "PASSED"),
			req("GENERATION", "PASSED"),
			req("CHECKOUT_SESSION", "PASSED"),
			{ ...req("LIVE_SETTLEMENT", "SKIPPED") },
		];
		const evaluation = evaluateReleaseDecision({ trigger: "POST_DEPLOY", verdicts });
		expect(evaluation.releaseDecision).toBe("ALLOW");
	});
});

// ─── Evidence contract conformance (§5.3) ──────────────────────────────

describe("evidence contract conformance (§5.3)", () => {
	it("AuthCanaryEvidence has exactly the required fields", () => {
		const evidence: AuthCanaryEvidence = {
			authPageHealthy: true,
			sessionEndpointHealthy: true,
			protectedRouteReachable: false,
		};
		expect(Object.keys(evidence).sort()).toEqual(
			["authPageHealthy", "protectedRouteReachable", "sessionEndpointHealthy"],
		);
		expect(typeof evidence.authPageHealthy).toBe("boolean");
		expect(typeof evidence.sessionEndpointHealthy).toBe("boolean");
		expect(typeof evidence.protectedRouteReachable).toBe("boolean");
	});

	it("GenerationCanaryEvidence has exactly the required fields", () => {
		const evidence: GenerationCanaryEvidence = {
			requestAccepted: true,
			terminalVerdict: "COMPLETE",
			artifactPresent: true,
			refundObserved: false,
		};
		expect(Object.keys(evidence).sort()).toEqual(
			["artifactPresent", "refundObserved", "requestAccepted", "terminalVerdict"],
		);
		expect(typeof evidence.requestAccepted).toBe("boolean");
		expect(["COMPLETE", "FAILED", "TIMEOUT"]).toContain(evidence.terminalVerdict);
		expect(typeof evidence.artifactPresent).toBe("boolean");
		expect(typeof evidence.refundObserved).toBe("boolean");
	});

	it("CheckoutSessionCanaryEvidence has exactly the required fields", () => {
		const evidence: CheckoutSessionCanaryEvidence = {
			requestAccepted: true,
			pendingObserved: true,
			readyObserved: true,
			hostedCheckoutUrlPresent: true,
		};
		expect(Object.keys(evidence).sort()).toEqual(
			["hostedCheckoutUrlPresent", "pendingObserved", "readyObserved", "requestAccepted"],
		);
		expect(typeof evidence.requestAccepted).toBe("boolean");
		expect(typeof evidence.pendingObserved).toBe("boolean");
		expect(typeof evidence.readyObserved).toBe("boolean");
		expect(typeof evidence.hostedCheckoutUrlPresent).toBe("boolean");
	});

	it("LiveSettlementCanaryEvidence has exactly the required fields", () => {
		const evidence: LiveSettlementCanaryEvidence = {
			checkoutCommitted: true,
			paidWebhookObserved: true,
			creditGrantCount: 1,
			authoritativeRevenueCount: 1,
			refundObserved: true,
		};
		expect(Object.keys(evidence).sort()).toEqual(
			["authoritativeRevenueCount", "checkoutCommitted", "creditGrantCount", "paidWebhookObserved", "refundObserved"],
		);
		expect(typeof evidence.checkoutCommitted).toBe("boolean");
		expect(typeof evidence.paidWebhookObserved).toBe("boolean");
		expect([0, 1]).toContain(evidence.creditGrantCount);
		expect([0, 1]).toContain(evidence.authoritativeRevenueCount);
		expect(typeof evidence.refundObserved).toBe("boolean");
	});

	it("classifiers accept evidence shapes without extra fields", () => {
		// Auth
		const authEvidence: AuthCanaryEvidence = {
			authPageHealthy: true,
			sessionEndpointHealthy: true,
			protectedRouteReachable: true,
		};
		expect(classifyAuthProbeVerdict(authEvidence, { requireProtectedRoute: true })).toBe("PASSED");

		// Checkout
		const coEvidence: CheckoutSessionCanaryEvidence = {
			requestAccepted: true,
			pendingObserved: true,
			readyObserved: true,
			hostedCheckoutUrlPresent: true,
		};
		expect(classifyCheckoutProbeVerdict(coEvidence)).toBe("PASSED");
	});
});

// ─── Canary principal config & scope invariants ────────────────────────

describe("canary principal config invariants", () => {
	it("has exactly four principals matching CANARY_PRINCIPAL_IDS", () => {
		const configKeys = Object.keys(CANARY_PRINCIPAL_CONFIG).sort();
		const ids = [...CANARY_PRINCIPAL_IDS].sort();
		expect(configKeys).toEqual(ids);
	});

	it("each principal proves a unique domain", () => {
		const domains = Object.values(CANARY_PRINCIPAL_CONFIG).map((c) => c.proves);
		expect(new Set(domains).size).toBe(domains.length);
	});

	it("each principal.id matches its config key", () => {
		for (const [key, config] of Object.entries(CANARY_PRINCIPAL_CONFIG)) {
			expect(config.id).toBe(key);
		}
	});

	it("only CANARY_SETTLEMENT is destructive", () => {
		for (const [key, config] of Object.entries(CANARY_PRINCIPAL_CONFIG)) {
			if (key === "CANARY_SETTLEMENT") {
				expect(config.destructive).toBe(true);
				expect(config.fundingClass).toBe("LIVE_PAYMENT");
			} else {
				expect(config.destructive).toBe(false);
			}
		}
	});

	it("all canary emails use the @celstate.app domain", () => {
		for (const config of Object.values(CANARY_PRINCIPAL_CONFIG)) {
			expect(config.email).toMatch(/@celstate\.app$/);
		}
	});

	it("CANARY_GENERATION requires at least 1 credit", () => {
		expect(CANARY_PRINCIPAL_CONFIG.CANARY_GENERATION.minimumCredits).toBeGreaterThanOrEqual(1);
	});
});

describe("gate config validation", () => {
	it("DEFAULT_GATE_CONFIG passes validation", () => {
		expect(() => assertValidGateConfig(DEFAULT_GATE_CONFIG)).not.toThrow();
	});

	it("rejects empty requiredOnDeploy", () => {
		expect(() =>
			assertValidGateConfig({ requiredOnDeploy: [], requiredOnSchedule: ["AUTH"] }),
		).toThrow();
	});

	it("rejects duplicate domains", () => {
		expect(() =>
			assertValidGateConfig({
				requiredOnDeploy: ["AUTH", "AUTH"],
				requiredOnSchedule: ["AUTH"],
			}),
		).toThrow();
	});
});
