import { expect, test } from '@playwright/test';

test.describe('Marketing landing (/)', () => {
	test('hydrates without Svelte hydration_mismatch and shows hero', async ({ page }) => {
		const failures: string[] = [];

		page.on('console', (msg) => {
			const text = msg.text();
			if (text.includes('hydration_mismatch')) {
				failures.push(`console:${msg.type()}:${text}`);
			}
		});

		page.on('pageerror', (err) => {
			failures.push(`pageerror:${err.message}`);
		});

		await page.goto('/');

		await expect(page.getByRole('heading', { name: /Already transparent/i })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Start Generating' }).first()).toBeVisible();

		// Allow async hydration / PostHog init to flush console messages.
		await page.waitForTimeout(750);

		expect(failures, failures.join('\n')).toEqual([]);
	});
});
