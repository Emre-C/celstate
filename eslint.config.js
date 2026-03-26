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
			'build/**',
			'dist/**'
		]
	},
	{
		files: ['**/*.{ts,tsx}'],
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
	}
);
