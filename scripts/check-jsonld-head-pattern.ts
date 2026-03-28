/**
 * Contract: JSON-LD in `<svelte:head>` must not combine `<svelte:element … type="application/ld+json">`
 * with `{@html …}` as a child — that pattern caused Svelte 5 `hydration_mismatch` on the marketing page.
 *
 * Safe pattern: `{@html \`<script type="application/ld+json">${jsonLd}</script>\`}` (single @html block).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const target = join('src', 'routes', '(marketing)', '+page.svelte');

function main() {
	let source: string;
	try {
		source = readFileSync(target, 'utf8');
	} catch (e) {
		console.error(`❌ Could not read ${target}:`, e);
		process.exit(1);
	}

	const forbidden =
		/<svelte:element[^>]*application\/ld\+json[^>]*>[\s\S]*?\{@html/m.test(source) ||
		/<svelte:element[^>]*>[\s\S]*?type\s*=\s*['"]application\/ld\+json['"][\s\S]*?\{@html/m.test(
			source
		);

	if (forbidden) {
		console.error(
			`❌ ${target}: forbidden JSON-LD pattern (svelte:element + inner {@html}) — causes hydration mismatch.\n` +
				'   Use a single {@html `<script type="application/ld+json">…</script>`} block instead.\n'
		);
		process.exit(1);
	}

	console.log(`✅ JSON-LD head pattern OK (${target}).\n`);
}

main();
