import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sentrySvelteKit({
		org: "emre-coklar",
		project: "celstate"
	}), tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		port: 5000,
		allowedHosts: true,
		strictPort: true,
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']
	}
});
