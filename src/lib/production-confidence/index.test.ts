import { describe, expect, it } from "vitest";
import {
	CANARY_PRINCIPAL_CONFIG,
	CANARY_PRINCIPAL_IDS,
	DEFAULT_GATE_CONFIG,
	FEATURE_DOMAINS,
	MAX_GENERATION_STAGES,
	MAX_WEBHOOK_DELIVERIES,
	VERDICTS,
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
	type CheckoutSessionCanaryEvent,
	type CheckoutSessionCanaryState,
	type CoordinatorDomainVerdict,
	type CoordinatorEvent,
	type CoordinatorState,
	type DomainLifecycleEvent,
	type DomainVerdictRecord,
	type FeatureDomain,
	type GenerationCanaryEvent,
	type GenerationCanaryEvidence,
	type GenerationCanaryState,
	type LiveSettlementCanaryEvent,
	type LiveSettlementCanaryEvidence,
	type LiveSettlementCanaryState,
} from "./index.js";

const authEvidenceBase = (partial: Partial<AuthCanaryEvidence> = {}): AuthCanaryEvidence => ({
	authPageHealthy: true,
	sessionEndpointHealthy: true,
	clerkFapiHealthy: true,
	clerkSignInWidgetHealthy: true,
	protectedRouteReachable: false,
	convexAuthenticatedQueryHealthy: true,
	signOutHealthy: true,
	preflightProvisioningHealthy: true,
	...partial,
});

const req = (domain: DomainVerdictRecord["domain"], verdict: DomainVerdictRecord["verdict"]): DomainVerdictRecord => ({
	domain,
	trigger: "POST_DEPLOY",
	requirement: "REQUIRED_ON_DEPLOY",
	verdict,
	evidenceRef: domain,
	startedAt: 1,
	finishedAt: 2,
});

describe("production confidence spec bounds", () => {
	it("matches formal spec §2.3 numeric limits", () => {
		expect(MAX_GENERATION_STAGES).toBe(3);
		expect(MAX_WEBHOOK_DELIVERIES).toBe(3);
	});
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
		const requiredOutcomes = VERDICTS;
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
	it("requires successful generations to produce a downloadable artifact", () => {
		expect(classifyGenerationOutcome({ status: "complete", resultStorageId: "storage_123" })).toBe(
			"FAILED",
		);
		expect(
			classifyGenerationOutcome({
				status: "complete",
				resultStorageId: "storage_123",
				artifactDownloadReachable: true,
			}),
		).toBe(
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
			classifyAuthProbeVerdict(authEvidenceBase({ protectedRouteReachable: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("PASSED");
	});

	it("passes when protected route required and reachable", () => {
		expect(
			classifyAuthProbeVerdict(
				authEvidenceBase({
					protectedRouteReachable: true,
					convexAuthenticatedQueryHealthy: true,
					signOutHealthy: true,
				}),
				{ requireProtectedRoute: true },
			),
		).toBe("PASSED");
	});

	it("fails when protected route required but not reachable (redirect to /auth)", () => {
		expect(
			classifyAuthProbeVerdict(
				authEvidenceBase({
					protectedRouteReachable: false,
					convexAuthenticatedQueryHealthy: true,
					signOutHealthy: true,
				}),
				{ requireProtectedRoute: true },
			),
		).toBe("FAILED");
	});

	it("fails when auth page is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(authEvidenceBase({ authPageHealthy: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("FAILED");
	});

	it("fails when session endpoint is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(authEvidenceBase({ sessionEndpointHealthy: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("FAILED");
	});

	it("fails when Clerk FAPI script probe is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(authEvidenceBase({ clerkFapiHealthy: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("FAILED");
	});

	it("fails when Clerk sign-in widget probe is unhealthy", () => {
		expect(
			classifyAuthProbeVerdict(authEvidenceBase({ clerkSignInWidgetHealthy: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("FAILED");
	});

	it("fails when preflight provisioning failed", () => {
		expect(
			classifyAuthProbeVerdict(authEvidenceBase({ preflightProvisioningHealthy: false }), {
				requireProtectedRoute: false,
			}),
		).toBe("FAILED");
	});

	it("fails when convex authenticated query unhealthy while protected route required", () => {
		expect(
			classifyAuthProbeVerdict(
				authEvidenceBase({
					protectedRouteReachable: true,
					convexAuthenticatedQueryHealthy: false,
					signOutHealthy: true,
				}),
				{ requireProtectedRoute: true },
			),
		).toBe("FAILED");
	});

	it("fails when sign-out unhealthy while protected route required", () => {
		expect(
			classifyAuthProbeVerdict(
				authEvidenceBase({
					protectedRouteReachable: true,
					convexAuthenticatedQueryHealthy: true,
					signOutHealthy: false,
				}),
				{ requireProtectedRoute: true },
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

	it("passes only when complete with artifact and download proof", () => {
		expect(classifyGenerationOutcome({ status: "complete", resultStorageId: "storage_123" })).toBe("FAILED");
		expect(classifyGenerationOutcome({ status: "complete", artifactPresent: true })).toBe("FAILED");
		expect(
			classifyGenerationOutcome({
				status: "complete",
				resultStorageId: "storage_123",
				artifactDownloadReachable: true,
			}),
		).toBe("PASSED");
		expect(
			classifyGenerationOutcome({
				status: "complete",
				artifactPresent: true,
				artifactDownloadReachable: true,
			}),
		).toBe("PASSED");
	});

	it("fails a completed generation when artifact download proof fails", () => {
		expect(
			classifyGenerationOutcome({
				status: "complete",
				artifactPresent: true,
				artifactDownloadReachable: false,
			}),
		).toBe("FAILED");
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
		const evidence: AuthCanaryEvidence = authEvidenceBase();
		expect(Object.keys(evidence).sort()).toEqual([
			"authPageHealthy",
			"clerkFapiHealthy",
			"clerkSignInWidgetHealthy",
			"convexAuthenticatedQueryHealthy",
			"preflightProvisioningHealthy",
			"protectedRouteReachable",
			"sessionEndpointHealthy",
			"signOutHealthy",
		]);
		expect(typeof evidence.authPageHealthy).toBe("boolean");
		expect(typeof evidence.sessionEndpointHealthy).toBe("boolean");
		expect(typeof evidence.clerkFapiHealthy).toBe("boolean");
		expect(typeof evidence.clerkSignInWidgetHealthy).toBe("boolean");
		expect(typeof evidence.protectedRouteReachable).toBe("boolean");
		expect(typeof evidence.convexAuthenticatedQueryHealthy).toBe("boolean");
		expect(typeof evidence.signOutHealthy).toBe("boolean");
		expect(typeof evidence.preflightProvisioningHealthy).toBe("boolean");
	});

	it("GenerationCanaryEvidence has exactly the required fields", () => {
		const evidence: GenerationCanaryEvidence = {
			artifactDigestHeaderPresent: true,
			artifactDownloadReachable: true,
			requestAccepted: true,
			terminalVerdict: "COMPLETE",
			artifactProbeStatus: 206,
			artifactUrlIssued: true,
			artifactPresent: true,
			refundObserved: false,
		};
		expect(Object.keys(evidence).sort()).toEqual(
			[
				"artifactDigestHeaderPresent",
				"artifactDownloadReachable",
				"artifactPresent",
				"artifactProbeStatus",
				"artifactUrlIssued",
				"refundObserved",
				"requestAccepted",
				"terminalVerdict",
			],
		);
		expect(typeof evidence.requestAccepted).toBe("boolean");
		expect(["COMPLETE", "FAILED", "TIMEOUT"]).toContain(evidence.terminalVerdict);
		expect(typeof evidence.artifactPresent).toBe("boolean");
		expect(typeof evidence.artifactUrlIssued).toBe("boolean");
		expect(typeof evidence.artifactDownloadReachable).toBe("boolean");
		expect(typeof evidence.artifactDigestHeaderPresent).toBe("boolean");
		expect(typeof evidence.artifactProbeStatus).toBe("number");
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
		const authEvidence: AuthCanaryEvidence = authEvidenceBase({
			protectedRouteReachable: true,
			convexAuthenticatedQueryHealthy: true,
			signOutHealthy: true,
		});
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

	it("all canary principals share one canonical QA identity", () => {
		// Production is Google-OAuth only — there is no email+password path —
		// so plus-addressed canary inboxes cannot be created. All four
		// principals must therefore bind to the same shared QA Google account.
		// Distinct canary identities would silently fail upsertCanaryPrincipal
		// in src/convex/verification.ts ("Canonical app user not found for …").
		const emails = new Set(
			Object.values(CANARY_PRINCIPAL_CONFIG).map((c) => c.email.toLowerCase()),
		);
		expect(emails.size).toBe(1);
		for (const config of Object.values(CANARY_PRINCIPAL_CONFIG)) {
			expect(config.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
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

	it("rejects requiredOnDeploy beyond MAX_REQUIRED_DEPLOY_DOMAINS", () => {
		expect(() =>
			assertValidGateConfig({
				requiredOnDeploy: ["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"],
				requiredOnSchedule: ["AUTH"],
			}),
		).toThrow();
	});
});

// ─── Totality across (state × event) for every transition (closes spec VO4) ──────

const COORDINATOR_STATES: CoordinatorState[] = ["IDLE", "RUNNING", "PASSED", "FAILED"];
const COORDINATOR_EVENTS: CoordinatorEvent[] = ["E_START", "E_FINALIZE_PASS", "E_FINALIZE_FAIL", "E_NOOP"];
const COORDINATOR_DOMAIN_VERDICTS: CoordinatorDomainVerdict[] = [
	"ABSENT", "PENDING", "RUNNING", "PASSED", "FAILED", "TIMEOUT", "SKIPPED",
];
const DOMAIN_LIFECYCLE_EVENTS: DomainLifecycleEvent[] = [
	"E_REQUIRE", "E_BEGIN", "E_PASS", "E_FAIL", "E_TIMEOUT", "E_SKIP", "E_NOOP",
];
const GENERATION_STATES: GenerationCanaryState[] = [
	"IDLE", "REQUESTED", "WHITE_BACKGROUND", "BLACK_BACKGROUND", "FINALIZING",
	"COMPLETE", "FAILED", "REFUNDED", "TIMEOUT",
];
const GENERATION_EVENTS: GenerationCanaryEvent[] = [
	"E_REQUEST_ACCEPTED", "E_ENTER_WHITE_BACKGROUND", "E_ENTER_BLACK_BACKGROUND",
	"E_ENTER_FINALIZING", "E_COMPLETE", "E_FAIL", "E_TIMEOUT", "E_REFUND", "E_NOOP",
];
const CHECKOUT_STATES: CheckoutSessionCanaryState[] = [
	"IDLE", "REQUESTED", "PENDING", "READY", "FAILED", "TIMEOUT",
];
const CHECKOUT_EVENTS: CheckoutSessionCanaryEvent[] = [
	"E_REQUEST_ACCEPTED", "E_PENDING_OBSERVED", "E_READY_OBSERVED",
	"E_FAIL_OBSERVED", "E_TIMEOUT", "E_NOOP",
];
const LIVE_SETTLEMENT_STATES: LiveSettlementCanaryState[] = [
	"IDLE", "SESSION_READY", "PAYMENT_COMMITTED", "PAID_WEBHOOK_OBSERVED",
	"GRANT_RECORDED", "REFUND_RECORDED", "FAILED", "TIMEOUT",
];
const LIVE_SETTLEMENT_EVENTS: LiveSettlementCanaryEvent[] = [
	"E_SESSION_READY", "E_PAYMENT_COMMITTED", "E_PAID_WEBHOOK_OBSERVED",
	"E_GRANT_RECORDED", "E_REFUND_RECORDED", "E_FAIL", "E_TIMEOUT", "E_NOOP",
];

describe("transition totality (§6 δ functions are total over State × Event)", () => {
	it("transitionDomainVerdict never throws and always returns a known verdict", () => {
		const valid = new Set<CoordinatorDomainVerdict>(COORDINATOR_DOMAIN_VERDICTS);
		for (const verdict of COORDINATOR_DOMAIN_VERDICTS) {
			for (const event of DOMAIN_LIFECYCLE_EVENTS) {
				let next: CoordinatorDomainVerdict | undefined;
				expect(() => { next = transitionDomainVerdict(verdict, event); }).not.toThrow();
				expect(valid.has(next!)).toBe(true);
			}
		}
	});

	it("transitionCoordinator never throws and always returns a known state", () => {
		const valid = new Set<CoordinatorState>(COORDINATOR_STATES);
		const requiredOnDeploy: FeatureDomain[] = ["AUTH", "GENERATION", "CHECKOUT_SESSION"];
		// Two representative outcome vectors: all-PASSED and AUTH-FAILED.
		const verdictVectors: Record<FeatureDomain, CoordinatorDomainVerdict>[] = [
			{ AUTH: "PASSED", GENERATION: "PASSED", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING" },
			{ AUTH: "FAILED", GENERATION: "PASSED", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING" },
		];
		for (const state of COORDINATOR_STATES) {
			for (const event of COORDINATOR_EVENTS) {
				for (const verdicts of verdictVectors) {
					let next: CoordinatorState | undefined;
					expect(() => { next = transitionCoordinator(state, event, verdicts, requiredOnDeploy); }).not.toThrow();
					expect(valid.has(next!)).toBe(true);
				}
			}
		}
	});

	it("transitionGenerationCanary never throws and always returns a known state", () => {
		const valid = new Set<GenerationCanaryState>(GENERATION_STATES);
		for (const state of GENERATION_STATES) {
			for (const event of GENERATION_EVENTS) {
				let next: GenerationCanaryState | undefined;
				expect(() => { next = transitionGenerationCanary(state, event); }).not.toThrow();
				expect(valid.has(next!)).toBe(true);
			}
		}
	});

	it("transitionCheckoutSessionCanary never throws and always returns a known state", () => {
		const valid = new Set<CheckoutSessionCanaryState>(CHECKOUT_STATES);
		for (const state of CHECKOUT_STATES) {
			for (const event of CHECKOUT_EVENTS) {
				let next: CheckoutSessionCanaryState | undefined;
				expect(() => { next = transitionCheckoutSessionCanary(state, event); }).not.toThrow();
				expect(valid.has(next!)).toBe(true);
			}
		}
	});

	it("transitionLiveSettlementCanary never throws and always returns a known state", () => {
		const valid = new Set<LiveSettlementCanaryState>(LIVE_SETTLEMENT_STATES);
		for (const state of LIVE_SETTLEMENT_STATES) {
			for (const event of LIVE_SETTLEMENT_EVENTS) {
				let next: LiveSettlementCanaryState | undefined;
				expect(() => { next = transitionLiveSettlementCanary(state, event); }).not.toThrow();
				expect(valid.has(next!)).toBe(true);
			}
		}
	});

	it("terminal states are absorbing for every transition function", () => {
		const coordinatorRequired: FeatureDomain[] = ["AUTH", "GENERATION", "CHECKOUT_SESSION"];
		const coordinatorVerdicts: Record<FeatureDomain, CoordinatorDomainVerdict> = {
			AUTH: "PASSED", GENERATION: "PASSED", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING",
		};
		for (const state of ["PASSED", "FAILED"] as const satisfies readonly CoordinatorState[]) {
			for (const event of COORDINATOR_EVENTS) {
				expect(transitionCoordinator(state, event, coordinatorVerdicts, coordinatorRequired)).toBe(state);
			}
		}
		for (const verdict of ["PASSED", "FAILED", "TIMEOUT", "SKIPPED"] satisfies CoordinatorDomainVerdict[]) {
			for (const event of DOMAIN_LIFECYCLE_EVENTS) {
				expect(transitionDomainVerdict(verdict, event)).toBe(verdict);
			}
		}
		for (const state of ["COMPLETE", "REFUNDED"] satisfies GenerationCanaryState[]) {
			for (const event of GENERATION_EVENTS) {
				expect(transitionGenerationCanary(state, event)).toBe(state);
			}
		}
		for (const state of ["READY", "FAILED", "TIMEOUT"] satisfies CheckoutSessionCanaryState[]) {
			for (const event of CHECKOUT_EVENTS) {
				expect(transitionCheckoutSessionCanary(state, event)).toBe(state);
			}
		}
		for (const state of ["REFUND_RECORDED", "FAILED", "TIMEOUT"] satisfies LiveSettlementCanaryState[]) {
			for (const event of LIVE_SETTLEMENT_EVENTS) {
				expect(transitionLiveSettlementCanary(state, event)).toBe(state);
			}
		}
	});
});

// ─── Coordinator §6.1: full δd path coverage ──────────────────────────────────

describe("transitionDomainVerdict path coverage", () => {
	it("ABSENT → PENDING → RUNNING → PASSED is the happy path", () => {
		expect(transitionDomainVerdict("ABSENT", "E_REQUIRE")).toBe("PENDING");
		expect(transitionDomainVerdict("PENDING", "E_BEGIN")).toBe("RUNNING");
		expect(transitionDomainVerdict("RUNNING", "E_PASS")).toBe("PASSED");
	});

	it("PENDING → SKIPPED is allowed; RUNNING → SKIPPED is not", () => {
		expect(transitionDomainVerdict("PENDING", "E_SKIP")).toBe("SKIPPED");
		expect(transitionDomainVerdict("RUNNING", "E_SKIP")).toBe("RUNNING");
	});

	it("E_FAIL and E_TIMEOUT terminate from PENDING and RUNNING", () => {
		expect(transitionDomainVerdict("PENDING", "E_FAIL")).toBe("FAILED");
		expect(transitionDomainVerdict("RUNNING", "E_FAIL")).toBe("FAILED");
		expect(transitionDomainVerdict("PENDING", "E_TIMEOUT")).toBe("TIMEOUT");
		expect(transitionDomainVerdict("RUNNING", "E_TIMEOUT")).toBe("TIMEOUT");
	});

	it("E_NOOP never changes state", () => {
		for (const v of COORDINATOR_DOMAIN_VERDICTS) {
			expect(transitionDomainVerdict(v, "E_NOOP")).toBe(v);
		}
	});
});

describe("transitionCoordinator path coverage", () => {
	const required: FeatureDomain[] = ["AUTH", "GENERATION", "CHECKOUT_SESSION"];
	const allPassed: Record<FeatureDomain, CoordinatorDomainVerdict> = {
		AUTH: "PASSED", GENERATION: "PASSED", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING",
	};
	const oneTimeout: Record<FeatureDomain, CoordinatorDomainVerdict> = {
		AUTH: "PASSED", GENERATION: "TIMEOUT", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING",
	};

	it("E_FINALIZE_PASS in RUNNING stays RUNNING when not all required passed", () => {
		const partial: Record<FeatureDomain, CoordinatorDomainVerdict> = {
			AUTH: "PASSED", GENERATION: "PENDING", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PENDING",
		};
		expect(transitionCoordinator("RUNNING", "E_FINALIZE_PASS", partial, required)).toBe("RUNNING");
	});

	it("E_FINALIZE_FAIL in RUNNING stays RUNNING when no required is in a bad terminal", () => {
		const allPending: Record<FeatureDomain, CoordinatorDomainVerdict> = {
			AUTH: "PENDING", GENERATION: "PENDING", CHECKOUT_SESSION: "PENDING", LIVE_SETTLEMENT: "PENDING",
		};
		expect(transitionCoordinator("RUNNING", "E_FINALIZE_FAIL", allPending, required)).toBe("RUNNING");
	});

	it("TIMEOUT in a required domain triggers FAILED on E_FINALIZE_FAIL", () => {
		const s = transitionCoordinator("RUNNING", "E_FINALIZE_FAIL", oneTimeout, required);
		expect(s).toBe("FAILED");
	});

	it("E_START from non-IDLE is a no-op", () => {
		expect(transitionCoordinator("RUNNING", "E_START", allPassed, required)).toBe("RUNNING");
		expect(transitionCoordinator("PASSED", "E_START", allPassed, required)).toBe("PASSED");
	});
});

// ─── Lifecycle §6.2/6.3/6.4: terminal absorption + faulting paths ────────────

describe("generation canary lifecycle (§6.2) path coverage", () => {
	it("FAIL during any active phase terminates as FAILED", () => {
		for (const s of ["REQUESTED", "WHITE_BACKGROUND", "BLACK_BACKGROUND", "FINALIZING"] as const) {
			expect(transitionGenerationCanary(s, "E_FAIL")).toBe("FAILED");
		}
	});

	it("TIMEOUT during any active phase terminates as TIMEOUT", () => {
		for (const s of ["REQUESTED", "WHITE_BACKGROUND", "BLACK_BACKGROUND", "FINALIZING"] as const) {
			expect(transitionGenerationCanary(s, "E_TIMEOUT")).toBe("TIMEOUT");
		}
	});

	it("REFUND is permitted only from FAILED or TIMEOUT", () => {
		expect(transitionGenerationCanary("FAILED", "E_REFUND")).toBe("REFUNDED");
		expect(transitionGenerationCanary("TIMEOUT", "E_REFUND")).toBe("REFUNDED");
		expect(transitionGenerationCanary("REQUESTED", "E_REFUND")).toBe("REQUESTED");
		expect(transitionGenerationCanary("COMPLETE", "E_REFUND")).toBe("COMPLETE");
	});
});

describe("checkout-session canary lifecycle (§6.3) path coverage", () => {
	it("REQUESTED → PENDING → READY is the canonical path", () => {
		let s: CheckoutSessionCanaryState = transitionCheckoutSessionCanary("IDLE", "E_REQUEST_ACCEPTED");
		s = transitionCheckoutSessionCanary(s, "E_PENDING_OBSERVED");
		s = transitionCheckoutSessionCanary(s, "E_READY_OBSERVED");
		expect(s).toBe("READY");
	});

	it("REQUESTED can shortcut to READY without observing PENDING", () => {
		expect(transitionCheckoutSessionCanary("REQUESTED", "E_READY_OBSERVED")).toBe("READY");
	});

	it("FAIL/TIMEOUT terminate from REQUESTED or PENDING", () => {
		expect(transitionCheckoutSessionCanary("REQUESTED", "E_FAIL_OBSERVED")).toBe("FAILED");
		expect(transitionCheckoutSessionCanary("REQUESTED", "E_TIMEOUT")).toBe("TIMEOUT");
		expect(transitionCheckoutSessionCanary("PENDING", "E_FAIL_OBSERVED")).toBe("FAILED");
		expect(transitionCheckoutSessionCanary("PENDING", "E_TIMEOUT")).toBe("TIMEOUT");
	});
});

describe("live-settlement canary lifecycle (§6.4) path coverage", () => {
	it("full happy path IDLE → REFUND_RECORDED", () => {
		let s: LiveSettlementCanaryState = transitionLiveSettlementCanary("IDLE", "E_SESSION_READY");
		s = transitionLiveSettlementCanary(s, "E_PAYMENT_COMMITTED");
		s = transitionLiveSettlementCanary(s, "E_PAID_WEBHOOK_OBSERVED");
		s = transitionLiveSettlementCanary(s, "E_GRANT_RECORDED");
		s = transitionLiveSettlementCanary(s, "E_REFUND_RECORDED");
		expect(s).toBe("REFUND_RECORDED");
	});

	it("FAIL is permitted from any post-IDLE active state", () => {
		for (const s of ["SESSION_READY", "PAYMENT_COMMITTED", "PAID_WEBHOOK_OBSERVED", "GRANT_RECORDED"] as const) {
			expect(transitionLiveSettlementCanary(s, "E_FAIL")).toBe("FAILED");
			expect(transitionLiveSettlementCanary(s, "E_TIMEOUT")).toBe("TIMEOUT");
		}
	});

	it("REFUND from non-GRANT_RECORDED states is a no-op (never collapses to REFUND_RECORDED)", () => {
		expect(transitionLiveSettlementCanary("PAID_WEBHOOK_OBSERVED", "E_REFUND_RECORDED")).toBe(
			"PAID_WEBHOOK_OBSERVED",
		);
		expect(transitionLiveSettlementCanary("FAILED", "E_REFUND_RECORDED")).toBe("FAILED");
	});
});

// ─── Gate evaluation: override paths and predicate edges ────────────────────

describe("evaluateReleaseDecision requiredDomains override (§5/§14)", () => {
	it("requiredDomains override takes precedence over gateConfig defaults", () => {
		const verdicts: DomainVerdictRecord[] = [req("AUTH", "PASSED")];
		const evaluation = evaluateReleaseDecision({
			trigger: "POST_DEPLOY",
			verdicts,
			requiredDomains: ["AUTH"],
		});
		expect(evaluation.releaseDecision).toBe("ALLOW");
		expect(evaluation.requiredDomains).toEqual(["AUTH"]);
	});

	it("override that includes a missing domain still produces DENY", () => {
		const verdicts: DomainVerdictRecord[] = [req("AUTH", "PASSED")];
		const evaluation = evaluateReleaseDecision({
			trigger: "POST_DEPLOY",
			verdicts,
			requiredDomains: ["AUTH", "LIVE_SETTLEMENT"],
		});
		expect(evaluation.releaseDecision).toBe("DENY");
		expect(evaluation.missingRequiredDomains).toEqual(["LIVE_SETTLEMENT"]);
	});
});

describe("acceptDeploy / rejectDeploy / scheduledSystemHealthy edges (§14)", () => {
	const allPassed: Record<FeatureDomain, "PASSED"> = {
		AUTH: "PASSED", GENERATION: "PASSED", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PASSED",
	};

	it("empty required set is vacuously accepted, never rejected", () => {
		expect(acceptDeploy([], allPassed)).toBe(true);
		expect(rejectDeploy([], allPassed)).toBe(false);
		expect(scheduledSystemHealthy([], allPassed)).toBe(true);
	});

	it("PENDING / RUNNING required verdicts neither accept nor reject", () => {
		const v: Record<FeatureDomain, "PENDING" | "RUNNING" | "PASSED"> = {
			AUTH: "PENDING", GENERATION: "RUNNING", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PASSED",
		};
		expect(acceptDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], v)).toBe(false);
		expect(rejectDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], v)).toBe(false);
	});

	it("rejectDeploy fires on TIMEOUT and SKIPPED, not just FAILED", () => {
		const timeoutVec: Record<FeatureDomain, "PASSED" | "TIMEOUT"> = {
			AUTH: "PASSED", GENERATION: "TIMEOUT", CHECKOUT_SESSION: "PASSED", LIVE_SETTLEMENT: "PASSED",
		};
		expect(rejectDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], timeoutVec)).toBe(true);
		const skippedVec: Record<FeatureDomain, "PASSED" | "SKIPPED"> = {
			AUTH: "PASSED", GENERATION: "PASSED", CHECKOUT_SESSION: "SKIPPED", LIVE_SETTLEMENT: "PASSED",
		};
		expect(rejectDeploy(["AUTH", "GENERATION", "CHECKOUT_SESSION"], skippedVec)).toBe(true);
	});
});

// ─── DomainVerdictRecord supports note + settlementOutcome optional fields ────

describe("DomainVerdictRecord optional fields (matches Convex validator)", () => {
	it("accepts a note string for diagnostic context", () => {
		const r: DomainVerdictRecord = { ...req("AUTH", "FAILED"), note: "[protected_route] redirect to /auth" };
		expect(r.note).toBe("[protected_route] redirect to /auth");
	});

	it("accepts a settlementOutcome on LIVE_SETTLEMENT verdicts", () => {
		const r: DomainVerdictRecord = {
			...req("LIVE_SETTLEMENT", "PASSED"),
			trigger: "SCHEDULED",
			requirement: "REQUIRED_ON_SCHEDULE",
			settlementOutcome: "GRANTED_ONCE",
		};
		expect(r.settlementOutcome).toBe("GRANTED_ONCE");
	});
});
