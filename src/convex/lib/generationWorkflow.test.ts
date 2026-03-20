import { describe, expect, it } from 'vitest';
import {
	getGenerationLastProgressAt,
	getGenerationRetryDelayMs,
	getGenerationRetryStatusMessage,
	hasRemainingStageRetries
} from './generationWorkflow.js';

describe('generation workflow helpers', () => {
	it('uses the last progress time when available', () => {
		expect(getGenerationLastProgressAt({ createdAt: 10, lastProgressAt: 25 })).toBe(25);
		expect(getGenerationLastProgressAt({ createdAt: 10 })).toBe(10);
	});

	it('builds retry messages per stage', () => {
		expect(getGenerationRetryStatusMessage('white_background', 0)).toBe('Creating your image…');
		expect(getGenerationRetryStatusMessage('white_background', 1)).toBe('Refining details…');
		expect(getGenerationRetryStatusMessage('black_background', 1)).toBe('Fine-tuning output…');
		expect(getGenerationRetryStatusMessage('finalizing', 1)).toBe('Still working on it (attempt 2)…');
	});

	it('applies exponential retry backoff', () => {
		expect(getGenerationRetryDelayMs(0)).toBe(1500);
		expect(getGenerationRetryDelayMs(1)).toBe(3000);
		expect(getGenerationRetryDelayMs(2)).toBe(6000);
	});

	it('caps stage retries independently for generation and finalization', () => {
		expect(hasRemainingStageRetries('white_background', 0)).toBe(true);
		expect(hasRemainingStageRetries('white_background', 1)).toBe(false);
		expect(hasRemainingStageRetries('finalizing', 0)).toBe(true);
		expect(hasRemainingStageRetries('finalizing', 1)).toBe(false);
	});
});
