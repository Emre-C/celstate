import { describe, expect, it } from 'vitest';
import { readGeminiRuntimeConfigFromEnv } from './gemini.js';

describe('readGeminiRuntimeConfigFromEnv', () => {
	it('parses service account json credentials and normalizes the private key', () => {
		const config = readGeminiRuntimeConfigFromEnv({
			VERTEX_AI_LOCATION: 'global',
			VERTEX_AI_PROJECT_ID: 'celstate-prod',
			VERTEX_AI_SERVICE_ACCOUNT_JSON: JSON.stringify({
				client_email: 'vertex@celstate.iam.gserviceaccount.com',
				private_key: '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----\\n',
				project_id: 'celstate-prod',
				type: 'service_account'
			})
		});

		expect(config.project).toBe('celstate-prod');
		expect(config.location).toBe('global');
		expect(config.googleAuthOptions?.projectId).toBe('celstate-prod');
		expect(config.googleAuthOptions?.credentials).toMatchObject({
			client_email: 'vertex@celstate.iam.gserviceaccount.com',
			project_id: 'celstate-prod',
			type: 'service_account'
		});
		expect(config.googleAuthOptions?.credentials?.private_key).toContain('\n');
	});

	it('uses google application credentials file paths when provided', () => {
		const config = readGeminiRuntimeConfigFromEnv({
			GOOGLE_APPLICATION_CREDENTIALS: '/secrets/vertex-service-account.json',
			GOOGLE_CLOUD_PROJECT: 'celstate-staging'
		});

		expect(config.project).toBe('celstate-staging');
		expect(config.location).toBe('global');
		expect(config.googleAuthOptions).toEqual({
			keyFilename: '/secrets/vertex-service-account.json',
			projectId: 'celstate-staging'
		});
	});

	it('throws when no vertex project is configured', () => {
		expect(() => readGeminiRuntimeConfigFromEnv({})).toThrow(
			'VERTEX_AI_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable not set'
		);
	});
});
