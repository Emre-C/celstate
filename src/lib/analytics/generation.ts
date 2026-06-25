import {
	GENERATION_FAILURE_KINDS,
	GENERATION_STAGES,
	type GenerationFailureKind,
	type GenerationStage,
} from '../generation-types.js';

export type { GenerationFailureKind };

export type GenerationFailureStage = GenerationStage;

export interface GenerationFailureClassificationInput {
	error?: string | null;
	stage?: string | null;
	statusMessage?: string | null;
}

export interface GenerationFailedAnalyticsProps {
	generation_id: string;
	failure_kind: GenerationFailureKind;
	failure_stage?: GenerationFailureStage;
	retry_count?: number;
}

const TIMEOUT_PATTERNS = [
	/\btimeout\b/i,
	/timed out/i,
	/without progress/i,
	/\bstalled\b/i,
	/exceeded .* without progress/i
];

const PROVIDER_ERROR_PATTERNS = [
	/\bgemini\b/i,
	/\bvertex\b/i,
	/\bgoogle\b/i,
	/\bquota\b/i,
	/rate limit/i,
	/429\b/i,
	/503\b/i,
	/service account/i,
	/api key/i,
	/credential/i,
	/\bmodel\b/i
];

const PROCESSING_ERROR_PATTERNS = [
	/validation failed/i,
	/failed to decode image/i,
	/empty image payload/i,
	/\bsharp\b/i,
	/aspect ratio mismatch/i,
	/stored image not found/i,
	/background image/i,
	/\bresize\b/i,
	/\bmatte\b/i,
	/\bpng\b/i,
	/optimiz/i,
	/\btransparency\b/i
];

export function isGenerationFailureKind(value: unknown): value is GenerationFailureKind {
	return GENERATION_FAILURE_KINDS.includes(value as GenerationFailureKind);
}

export function normalizeGenerationFailureStage(value: unknown): GenerationFailureStage | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	return GENERATION_STAGES.includes(value as GenerationStage)
		? (value as GenerationFailureStage)
		: undefined;
}

function joinFailureContext(args: GenerationFailureClassificationInput): string {
	return [args.error, args.statusMessage, args.stage]
		.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
		.join('\n');
}

export function classifyGenerationFailureKind(
	args: GenerationFailureClassificationInput
): GenerationFailureKind {
	const failureContext = joinFailureContext(args);

	if (!failureContext) {
		return 'unknown';
	}

	if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(failureContext))) {
		return 'timeout';
	}

	if (PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(failureContext))) {
		return 'provider_error';
	}

	if (PROCESSING_ERROR_PATTERNS.some((pattern) => pattern.test(failureContext))) {
		return 'processing_error';
	}

	return 'unknown';
}

export function buildGenerationFailedAnalyticsProps(args: {
	generationId: string;
	error?: string | null;
	failureKind?: string | null;
	failureStage?: string | null;
	retryCount?: number | null;
	stage?: string | null;
	statusMessage?: string | null;
}): GenerationFailedAnalyticsProps {
	const failureStage = normalizeGenerationFailureStage(args.failureStage ?? args.stage);
	const props: GenerationFailedAnalyticsProps = {
		generation_id: args.generationId,
		failure_kind: isGenerationFailureKind(args.failureKind)
			? args.failureKind
			: classifyGenerationFailureKind({
					error: args.error,
					stage: args.stage,
					statusMessage: args.statusMessage
			  })
	};

	if (failureStage) {
		props.failure_stage = failureStage;
	}

	if (typeof args.retryCount === 'number') {
		props.retry_count = args.retryCount;
	}

	return props;
}
