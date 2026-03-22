import { describe, expect, it } from 'vitest';
import {
	buildGenerationFailedAnalyticsProps,
	classifyGenerationFailureKind
} from './generation.js';

describe('generation analytics helpers', () => {
	it('classifies timeout failures from stalled-generation signals', () => {
		expect(
			classifyGenerationFailureKind({
				error: 'Generation exceeded 900000ms without progress'
			})
		).toBe('timeout');
	});

	it('classifies provider failures from model and quota errors', () => {
		expect(
			classifyGenerationFailureKind({
				error: 'Vertex quota exhausted while calling Gemini image generation'
			})
		).toBe('provider_error');
	});

	it('classifies processing failures from image pipeline errors', () => {
		expect(
			classifyGenerationFailureKind({
				error: 'Failed to decode image: unsupported PNG payload'
			})
		).toBe('processing_error');
	});

	it('builds analytics-safe generation_failed properties', () => {
		expect(
			buildGenerationFailedAnalyticsProps({
				failureKind: 'processing_error',
				failureStage: 'black_background',
				generationId: 'gen_123',
				retryCount: 2
			})
		).toEqual({
			generation_id: 'gen_123',
			failure_kind: 'processing_error',
			failure_stage: 'black_background',
			retry_count: 2
		});
	});
});
