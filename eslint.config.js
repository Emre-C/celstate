import tseslint from 'typescript-eslint';

/**
 * Minimal ESLint: only `@typescript-eslint/ban-ts-comment` (see docs/implementation/hardening.md).
 * Broader lint rules are intentionally not enabled yet.
 */
export default tseslint.config(
	{
		ignores: [
			'**/node_modules/**',
			'src/convex/_generated/**',
			'.svelte-kit/**',
			'**/.svelte-kit/**',
			'build/**',
			'dist/**',
			'**/dist/**',
			'archive/**'
		]
	},
	{
		files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'e2e/**/*.ts', 'playwright.config.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin
		},
		rules: {
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-expect-error': 'allow-with-description',
					minimumDescriptionLength: 10
				}
			]
		}
	},
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: false
			},
			ecmaVersion: 'latest',
			sourceType: 'module'
		},
		plugins: {
			'@typescript-eslint': tseslint.plugin
		},
		rules: {
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{
					'ts-expect-error': 'allow-with-description',
					minimumDescriptionLength: 10
				}
			]
		}
	}
);
