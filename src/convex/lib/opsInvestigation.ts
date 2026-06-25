import { v } from 'convex/values';
import {
	domainVerdictRecordValidator,
	generationStageValidator,
	verificationTriggerValidator
} from './validation/validators.js';

export const criticalPathVerdictValidator = v.union(
	v.literal('pass'),
	v.literal('fail'),
	v.literal('in_flight'),
	v.literal('not_applicable'),
	v.literal('unknown')
);

export const downloadProbeValidator = v.object({
	contentLength: v.optional(v.number()),
	contentType: v.optional(v.string()),
	digestHeaderPresent: v.boolean(),
	error: v.optional(v.string()),
	ok: v.boolean(),
	status: v.optional(v.number())
});

export const generationArtifactsValidator = v.object({
	optimizedDownloadProbe: v.optional(downloadProbeValidator),
	optimizedStorageIdPresent: v.boolean(),
	optimizedUrlIssued: v.boolean(),
	resultDownloadProbe: v.optional(downloadProbeValidator),
	resultStorageIdPresent: v.boolean(),
	resultUrlIssued: v.boolean()
});

export const opsTimelineEventValidator = v.object({
	attemptDurationMs: v.optional(v.number()),
	createdAt: v.number(),
	error: v.optional(v.string()),
	eventType: v.union(
		v.literal('generation_requested'),
		v.literal('stage_succeeded'),
		v.literal('stage_retry_scheduled'),
		v.literal('generation_completed'),
		v.literal('generation_failed'),
		v.literal('generation_stalled'),
		v.literal('alert_sent'),
		v.literal('alert_failed')
	),
	generationDurationMs: v.optional(v.number()),
	retryCount: v.optional(v.number()),
	severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
	stage: v.optional(generationStageValidator),
	statusMessage: v.optional(v.string()),
	totalRetryCount: v.optional(v.number())
});

export const generationInvestigationVerdictValidator = v.object({
	auth: criticalPathVerdictValidator,
	download: criticalPathVerdictValidator,
	generation: criticalPathVerdictValidator,
	recommendedAction: v.string(),
	refund: criticalPathVerdictValidator,
	systemRecovered: v.boolean(),
	userRecoveredAfterThis: v.boolean(),
	userRetriedAfterThis: v.boolean()
});

export const generationInvestigationReportValidator = v.object({
	artifacts: generationArtifactsValidator,
	generation: v.object({
		completedAt: v.optional(v.number()),
		createdAt: v.number(),
		creditRefunded: v.boolean(),
		failureKind: v.optional(
			v.union(
				v.literal('timeout'),
				v.literal('provider_error'),
				v.literal('processing_error'),
				v.literal('unknown')
			)
		),
		failureStage: v.optional(generationStageValidator),
		generationTimeMs: v.optional(v.number()),
		id: v.string(),
		internalError: v.optional(v.string()),
		retryCount: v.number(),
		stage: v.optional(generationStageValidator),
		status: v.union(v.literal('generating'), v.literal('complete'), v.literal('failed')),
		userFacingError: v.optional(v.string()),
		userId: v.string()
	}),
	opsTimeline: v.array(opsTimelineEventValidator),
	user: v.object({
		completedGenerations: v.number(),
		credits: v.optional(v.number()),
		email: v.optional(v.string()),
		failedGenerations: v.number(),
		id: v.string(),
		laterCompletedGenerations: v.number(),
		laterGenerations: v.number(),
		totalGenerations: v.number()
	}),
	verdict: generationInvestigationVerdictValidator
});

export const generationInvestigationReadModelValidator = v.union(
	v.object({
		artifactUrls: v.object({
			optimizedUrl: v.optional(v.string()),
			resultUrl: v.optional(v.string())
		}),
		report: generationInvestigationReportValidator
	}),
	v.null()
);

export const generationSummaryValidator = v.object({
	completedAt: v.optional(v.number()),
	createdAt: v.number(),
	creditRefunded: v.boolean(),
	failureKind: v.optional(
		v.union(
			v.literal('timeout'),
			v.literal('provider_error'),
			v.literal('processing_error'),
			v.literal('unknown')
		)
	),
	failureStage: v.optional(generationStageValidator),
	id: v.string(),
	optimizedStorageIdPresent: v.boolean(),
	prompt: v.string(),
	resultStorageIdPresent: v.boolean(),
	retryCount: v.number(),
	stage: v.optional(generationStageValidator),
	status: v.union(v.literal('generating'), v.literal('complete'), v.literal('failed'))
});

export const userInvestigationReportValidator = v.union(
	v.object({
		authBinding: v.object({
			clerkUserIdPresent: v.boolean(),
			tokenIdentifierPresent: v.boolean()
		}),
		latestGenerations: v.array(generationSummaryValidator),
		user: v.object({
			credits: v.optional(v.number()),
			email: v.optional(v.string()),
			id: v.string()
		}),
		verdict: v.object({
			auth: criticalPathVerdictValidator,
			download: criticalPathVerdictValidator,
			generation: criticalPathVerdictValidator,
			recommendedAction: v.string()
		}),
		window: v.object({
			limit: v.number(),
			now: v.number()
		})
	}),
	v.null()
);

export const recentGenerationIncidentsReportValidator = v.object({
	incidents: v.array(
		v.object({
			attemptDurationMs: v.optional(v.number()),
			createdAt: v.number(),
			error: v.optional(v.string()),
			eventType: v.union(
				v.literal('generation_failed'),
				v.literal('generation_stalled'),
				v.literal('alert_failed')
			),
			generationDurationMs: v.optional(v.number()),
			generationId: v.string(),
			retryCount: v.optional(v.number()),
			severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
			stage: v.optional(generationStageValidator),
			statusMessage: v.optional(v.string()),
			totalRetryCount: v.optional(v.number()),
			userEmail: v.optional(v.string()),
			userId: v.string()
		})
	),
	window: v.object({
		hoursWindow: v.number(),
		limit: v.number(),
		now: v.number(),
		since: v.number()
	})
});

export const criticalPathHealthReportValidator = v.object({
	evidence: v.object({
		auth: v.union(
			v.object({
				evidenceRef: v.string(),
				payloadJson: v.optional(v.string())
			}),
			v.null()
		),
		generation: v.union(
			v.object({
				evidenceRef: v.string(),
				payloadJson: v.optional(v.string())
			}),
			v.null()
		)
	}),
	latestRun: v.union(
		v.object({
			ageMs: v.number(),
			authVerdict: v.optional(domainVerdictRecordValidator),
			checkoutSessionVerdict: v.optional(domainVerdictRecordValidator),
			deploymentId: v.optional(v.string()),
			finishedAt: v.optional(v.number()),
			generationVerdict: v.optional(domainVerdictRecordValidator),
			gitSha: v.optional(v.string()),
			liveSettlementVerdict: v.optional(domainVerdictRecordValidator),
			releaseDecision: v.optional(v.union(v.literal('ALLOW'), v.literal('DENY'))),
			runKey: v.string(),
			siteUrl: v.optional(v.string()),
			startedAt: v.number(),
			trigger: verificationTriggerValidator,
			workflowRunId: v.optional(v.string())
		}),
		v.null()
	),
	verdict: v.object({
		auth: criticalPathVerdictValidator,
		download: criticalPathVerdictValidator,
		generation: criticalPathVerdictValidator,
		recommendedAction: v.string()
	})
});

export const recentSignupsReportValidator = v.object({
	signups: v.array(
		v.object({
			createdAt: v.number(),
			credits: v.optional(v.number()),
			email: v.optional(v.string()),
			id: v.string(),
			name: v.optional(v.string())
		})
	),
	window: v.object({
		hoursWindow: v.number(),
		limit: v.number(),
		now: v.number(),
		since: v.number()
	})
});
