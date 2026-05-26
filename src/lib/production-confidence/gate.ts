/**
 * Production confidence — gate configuration, predicates, and verdict evaluation.
 */

import {
	DEFAULT_GATE_CONFIG,
	FEATURE_DOMAINS,
	MAX_DOMAINS,
	MAX_REQUIRED_DEPLOY_DOMAINS,
	MAX_WEBHOOK_DELIVERIES,
	MAX_GENERATION_STAGES,
	VERDICTS,
	CANARY_PRINCIPAL_CONFIG,
	CANARY_PRINCIPAL_IDS,
	CANARY_FUNDING_CLASSES,
	REQUIREMENT_CLASSES,
	VERIFICATION_TRIGGERS,
	type FeatureDomain,
	type GateConfig,
	type RequirementClass,
	type Verdict,
	type VerdictByDomain,
	type VerificationTrigger,
	type DomainVerdictRecord,
	type DeploymentVerificationRun,
	type SettlementOutcome,
	type ReleaseDecision,
	type GenerationCanaryEvidence,
	type AuthCanaryEvidence,
	type CheckoutSessionCanaryEvidence,
	type LiveSettlementCanaryEvidence,
	type CanaryPrincipalId,
	type CanaryPrincipal,
	type CanaryPrincipalDefinition,
	type CanaryFundingClass,
} from "./types.js";

export {
	DEFAULT_GATE_CONFIG,
	FEATURE_DOMAINS,
	MAX_DOMAINS,
	MAX_REQUIRED_DEPLOY_DOMAINS,
	MAX_WEBHOOK_DELIVERIES,
	MAX_GENERATION_STAGES,
	VERDICTS,
	CANARY_PRINCIPAL_CONFIG,
	CANARY_PRINCIPAL_IDS,
	CANARY_FUNDING_CLASSES,
	REQUIREMENT_CLASSES,
	VERIFICATION_TRIGGERS,
	type FeatureDomain,
	type GateConfig,
	type RequirementClass,
	type Verdict,
	type VerdictByDomain,
	type VerificationTrigger,
	type DomainVerdictRecord,
	type DeploymentVerificationRun,
	type SettlementOutcome,
	type ReleaseDecision,
	type GenerationCanaryEvidence,
	type AuthCanaryEvidence,
	type CheckoutSessionCanaryEvidence,
	type LiveSettlementCanaryEvidence,
	type CanaryPrincipalId,
	type CanaryPrincipal,
	type CanaryPrincipalDefinition,
	type CanaryFundingClass,
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
