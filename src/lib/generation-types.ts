export const GENERATION_STAGES = [
	'white_background',
	'black_background',
	'finalizing',
] as const;

export type GenerationStage = (typeof GENERATION_STAGES)[number];

export const GENERATION_FAILURE_KINDS = [
	'timeout',
	'provider_error',
	'processing_error',
	'unknown',
] as const;

export type GenerationFailureKind = (typeof GENERATION_FAILURE_KINDS)[number];

export const GENERATION_STATUSES = [
	'generating',
	'complete',
	'failed',
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const GENERATION_OPS_EVENT_TYPES = [
	'generation_requested',
	'stage_succeeded',
	'stage_retry_scheduled',
	'generation_completed',
	'generation_failed',
	'generation_stalled',
	'alert_sent',
	'alert_failed',
] as const;

export type GenerationOpsEventType = (typeof GENERATION_OPS_EVENT_TYPES)[number];
