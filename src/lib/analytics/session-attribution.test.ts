import { describe, expect, it } from 'vitest';
import {
	buildSessionAttributionProps,
	captureSessionAttributionOnce,
	type SessionAttributionProps,
	type SessionAttributionStorage
} from './session-attribution.js';

class MemorySessionStorage implements SessionAttributionStorage {
	private readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

describe('session attribution helpers', () => {
	it('builds attribution properties from the landing url', () => {
		expect(
			buildSessionAttributionProps(
				new URL('https://celstate.com/app?utm_source=google&utm_medium=cpc&utm_campaign=launch'),
				'https://www.google.com/search?q=celstate'
			)
		).toEqual({
			landing_path: '/app',
			referrer: 'https://www.google.com/search?q=celstate',
			utm_campaign: 'launch',
			utm_medium: 'cpc',
			utm_source: 'google'
		});
	});

	it('captures attribution at most once per session', () => {
		const storage = new MemorySessionStorage();
		const captured: Array<{ event: string; properties: SessionAttributionProps }> = [];
		const url = new URL('https://celstate.com/?utm_source=twitter');

		expect(
			captureSessionAttributionOnce({
				capture: (event, properties) => captured.push({
					event,
					properties
				}),
				referrer: '',
				storage,
				url
			})
		).toBe(true);
		expect(captured).toEqual([
			{
				event: 'session_attribution_registered',
				properties: {
					landing_path: '/',
					utm_source: 'twitter'
				}
			}
		]);

		expect(
			captureSessionAttributionOnce({
				capture: (event, properties) => captured.push({
					event,
					properties
				}),
				referrer: '',
				storage,
				url
			})
		).toBe(false);
		expect(captured).toHaveLength(1);
	});
});
