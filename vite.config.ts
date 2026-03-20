import { sentrySvelteKit } from "@sentry/sveltekit";
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sentrySvelteKit({
        org: "emre-coklar",
        project: "celstate"
    }), tailwindcss(), sveltekit()],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
