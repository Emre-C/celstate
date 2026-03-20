import { GENERATION_CONFIG } from './config.js';

export type GenerationStage = 'white_background' | 'black_background' | 'finalizing';

export function getGenerationStageStatusMessage(stage: GenerationStage): string {
	switch (stage) {
		case 'white_background':
			return 'Creating your image…';
		case 'black_background':
			return 'Enhancing quality…';
		case 'finalizing':
			return 'Preparing final image…';
	}
}

export function getGenerationRetryStatusMessage(stage: GenerationStage, retryCount: number): string {
	switch (stage) {
		case 'white_background':
			return retryCount > 0 ? 'Refining details…' : getGenerationStageStatusMessage(stage);
		case 'black_background':
			return retryCount > 0 ? 'Fine-tuning output…' : getGenerationStageStatusMessage(stage);
		case 'finalizing':
			return retryCount > 0
				? `Still working on it (attempt ${retryCount + 1})…`
				: getGenerationStageStatusMessage(stage);
	}
}

export function getGenerationRetryDelayMs(retryCount: number): number {
	return GENERATION_CONFIG.retryBaseDelayMs * Math.pow(2, retryCount);
}

export function getGenerationLastProgressAt(record: {
	createdAt: number;
	lastProgressAt?: number;
}): number {
	return record.lastProgressAt ?? record.createdAt;
}

export function hasRemainingStageRetries(stage: GenerationStage, retryCount: number): boolean {
	if (stage === 'finalizing') {
		return retryCount < GENERATION_CONFIG.maxFinalizeRetries;
	}

	return retryCount < GENERATION_CONFIG.maxRetriesPerPass;
}
