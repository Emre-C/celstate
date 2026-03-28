import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against `vite preview` so SSR + hydration match production.
 * CI sets `PUBLIC_SITE_URL` to the preview origin so canonical redirects do not
 * bounce the browser away from localhost (see hooks.server.ts).
 */
const previewOrigin = 'http://127.0.0.1:4174';

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: previewOrigin,
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm exec vite preview --host 127.0.0.1 --port 4174',
		url: previewOrigin,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
