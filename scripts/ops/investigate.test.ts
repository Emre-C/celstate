import { describe, expect, it } from 'vitest';
import {
	buildConvexRunInvocation,
	buildInvocationForCommand,
	parseArgs
} from './investigate.js';

describe('ops investigation CLI argv construction', () => {
	it('builds Convex run calls as argv arrays with JSON args as one token', () => {
		const invocation = buildConvexRunInvocation('ops:getGenerationInvestigation', {
			generationId: 'gen with spaces',
			now: 42
		});

		expect(invocation.args.slice(-6)).toEqual([
			'exec',
			'convex',
			'run',
			'--prod',
			'ops:getGenerationInvestigation',
			'{"generationId":"gen with spaces","now":42}'
		]);
		expect(invocation.args).not.toContain('|');
	});

	it('maps generation investigations to the internal Convex read model', () => {
		const invocation = buildInvocationForCommand(
			parseArgs(['generation', '--id', 'kg123']),
			1_234
		);

		expect(invocation.functionName).toBe('ops:getGenerationInvestigation');
		expect(invocation.jsonArgs).toEqual({
			generationId: 'kg123',
			now: 1_234
		});
	});

	it('maps user email investigations without requiring a user ID', () => {
		const invocation = buildInvocationForCommand(
			parseArgs(['user', '--email', ' Ada@Example.COM ', '--limit', '7']),
			1_234
		);

		expect(invocation.functionName).toBe('ops:getUserInvestigation');
		expect(invocation.jsonArgs).toEqual({
			email: 'ada@example.com',
			limit: 7,
			now: 1_234
		});
	});

	it('maps recent incidents to a bounded window', () => {
		const invocation = buildInvocationForCommand(
			parseArgs(['recent', '--limit=5', '--hours=12']),
			1_234
		);

		expect(invocation.functionName).toBe('ops:getRecentGenerationIncidents');
		expect(invocation.jsonArgs).toEqual({
			hoursWindow: 12,
			limit: 5,
			now: 1_234
		});
	});

	it('rejects missing required selectors before invoking Convex', () => {
		expect(() => buildInvocationForCommand(parseArgs(['generation']), 1_234)).toThrow(
			'generation requires --id <generationId>'
		);
		expect(() => buildInvocationForCommand(parseArgs(['user']), 1_234)).toThrow(
			'user requires --email <email> or --id <userId>'
		);
	});
});
