export const DEFAULT_ROOT = "tmp/transparent-animation-spike";
export const DEFAULT_CHROMA_COLOR = "#00ff00";
export const DEFAULT_CHROMA_SIMILARITY = 0.12;
export const DEFAULT_CHROMA_BLEND = 0.08;
export const DEFAULT_PROVIDER_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
export const DEFAULT_PROVIDER_VIDEO_MODEL = "veo-3.1-fast-generate-preview";
export const DEFAULT_PROVIDER_ASPECT_RATIO = "16:9";
export const DEFAULT_PROVIDER_IMAGE_SIZE = "1K";
export const DEFAULT_PROVIDER_VIDEO_RESOLUTION = "720p";
export const DEFAULT_PROVIDER_DURATION_SECONDS = 8;
export const DEFAULT_PROVIDER_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_PROVIDER_MAX_WAIT_MS = 30 * 60 * 1000;

export const STAGES = ["chroma-baseline", "matting-baseline", "celstate-alpha-v0", "celstate-alpha-v1-despill", "celstate-alpha-v2-trimap", "celstate-alpha-v3-core-fringe", "celstate-alpha-v4-prior-fusion", "celstate-alpha-v5-video-prior", "celstate-alpha-v6-projection", "celstate-alpha-v7", "video-prior"] as const;
export type Stage = typeof STAGES[number];

export const SOURCE_MODES = ["text-to-video", "image-to-video", "ingredients-to-video"] as const;
export type SourceMode = typeof SOURCE_MODES[number];

export const REFERENCE_ROLES = ["first-frame", "reference-image"] as const;
export type ReferenceRole = typeof REFERENCE_ROLES[number];

export const METRIC_KEYS = [
	"alphaUsability",
	"temporalCoherence",
	"edgeSpillHalo",
	"identityStability",
	"internalMotion",
	"secondaryMotionCoupling",
	"promptCompliance",
	"editorCompatibility",
	"overallAwe",
] as const;
export type MetricKey = typeof METRIC_KEYS[number];

export interface ParsedArgs {
	readonly command: string;
	readonly options: ReadonlyMap<string, readonly string[]>;
	readonly positionals: readonly string[];
}

export interface PromptFixture {
	readonly chromaPrompt: string;
	readonly expectedHardParts: string;
	readonly id: string;
	readonly passCriteria: string;
	readonly prompt: string;
	readonly source: string;
	readonly tests: string;
	readonly title: string;
	readonly useCase: string;
}

export interface ChromaSettings {
	readonly blend: number;
	readonly color: string;
	readonly similarity: number;
}

export interface GenerationMetadata {
	readonly costUsd?: number;
	readonly latencySeconds?: number;
	readonly model?: string;
	readonly provider?: string;
	readonly seed?: string;
	readonly settings?: Record<string, string>;
}

export interface RunInput {
	readonly chroma: ChromaSettings;
	readonly createdAt: string;
	readonly generation: GenerationMetadata;
	readonly prompt: PromptFixture;
	readonly reference?: {
		readonly normalized: string;
		readonly originalPath: string;
		readonly role: ReferenceRole;
		readonly storedOriginal: string;
	};
	readonly lastFrame?: {
		readonly normalized: string;
		readonly originalPath: string;
		readonly storedOriginal: string;
	};
	readonly runId: string;
	readonly sourceMode?: SourceMode;
	readonly source?: {
		readonly originalPath: string;
		readonly storedOriginal: string;
		readonly normalized: string;
	};
}

export interface ManualScore {
	readonly aggregate: number;
	readonly artifactPath?: string;
	readonly createdAt: string;
	readonly failures: readonly string[];
	readonly metrics: Record<MetricKey, number>;
	readonly notes: string;
	readonly stage: Stage;
}

export interface ScoresFile {
	readonly runId: string;
	readonly scores: Partial<Record<Stage, ManualScore>>;
	readonly updatedAt: string;
}

export interface CommandResult {
	readonly logPath?: string;
	readonly stderr: string;
	readonly stdout: string;
}

export interface RunContext {
	readonly directory: string;
	readonly runId: string;
}

export interface RunEvent {
	readonly data?: Record<string, unknown>;
	readonly event: string;
	readonly level: "error" | "info" | "warn";
	readonly message: string;
	readonly runId: string;
	readonly stage?: string;
	readonly timestamp: string;
}

export interface StepState {
	readonly commandLog?: string;
	readonly durationMs?: number;
	readonly endedAt?: string;
	readonly error?: string;
	readonly metadata?: Record<string, unknown>;
	readonly outputs?: readonly string[];
	readonly skippedBecauseComplete?: boolean;
	readonly startedAt?: string;
	readonly status: "failed" | "running" | "succeeded";
}

export interface ProviderGenerationOptions {
	readonly aspectRatio: string;
	readonly durationSeconds: number;
	readonly estimatedProviderCostUsd?: number;
	readonly force: boolean;
	readonly imageSize: string;
	readonly maxWaitMs: number;
	readonly pollIntervalMs: number;
	readonly seed?: number;
	readonly videoModel: string;
	readonly videoResolution: string;
}

export interface VideoOperationRecord {
	readonly config: {
		readonly aspectRatio: string;
		readonly durationSeconds: number;
		readonly resolution: string;
		readonly seed?: number;
	};
	readonly firstFrame: string;
	readonly lastFrame: string;
	readonly model: string;
	readonly operationName: string;
	readonly promptPath: string;
	readonly submittedAt: string;
}

export interface PipelineState {
	readonly runId: string;
	readonly steps: Record<string, StepState>;
	readonly updatedAt: string;
}

export interface ProviderCallSummary {
	readonly attemptId: string;
	readonly call: string;
	readonly durationMs?: number;
	readonly endedAt?: string;
	readonly error?: string;
	readonly metadata?: Record<string, unknown>;
	readonly model?: string;
	readonly startedAt: string;
	readonly status: "failed" | "running" | "succeeded";
}
