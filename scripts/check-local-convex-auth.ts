/**
 * Verifies local SvelteKit → Convex Better Auth wiring for development.
 *
 * Usage:  pnpm check:convex-auth
 *
 * Loads `.env` then `.env.local` from the repo root, then overlays `process.env`.
 * Resolves the Convex site URL the same way as `src/routes/api/auth/[...all]/+server.ts`
 * (`PUBLIC_CONVEX_URL` → derived `*.convex.site`, or `PUBLIC_CONVEX_SITE_URL` when needed),
 * then GETs `/api/auth/get-session` on that host.
 *
 * If this fails but you "have auth locally", typical causes are:
 * - Only `vite dev` is running (use `pnpm dev` so `convex dev` runs too), or
 * - `PUBLIC_CONVEX_URL` / optional `PUBLIC_CONVEX_SITE_URL` don’t match the deployment `convex dev` uses.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveConvexSiteUrlForAuthProxy } from "../src/lib/server/convex-site-url.js";

function loadEnvFile(name: string): Record<string, string> {
	const p = resolve(process.cwd(), name);
	if (!existsSync(p)) {
		return {};
	}
	const raw = readFileSync(p, "utf8");
	const out: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		out[key] = val;
	}
	return out;
}

function mergedEnv(): Record<string, string | undefined> {
	return {
		...loadEnvFile(".env"),
		...loadEnvFile(".env.local"),
		...process.env
	};
}

async function main() {
	console.log("Checking local Convex auth proxy (resolved site URL from env)...\n");

	const env = mergedEnv();
	let site: string;
	try {
		site = resolveConvexSiteUrlForAuthProxy({
			publicConvexUrl: env.PUBLIC_CONVEX_URL,
			publicConvexSiteUrl: env.PUBLIC_CONVEX_SITE_URL
		});
	} catch (e) {
		console.error(
			`❌ ${e instanceof Error ? e.message : String(e)}\n` +
				"   See docs/product/authentication.md (Convex / public env).\n"
		);
		process.exit(1);
	}

	const base = new URL(site);

	const sessionUrl = new URL("/api/auth/get-session", base);
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), 12_000);

	try {
		const res = await fetch(sessionUrl, {
			method: "GET",
			signal: controller.signal,
			headers: { accept: "application/json" }
		});
		clearTimeout(t);
		console.log(`✅ Reachable: ${sessionUrl.origin} (HTTP ${res.status} on get-session)`);
		console.log(
			"\n   SvelteKit proxies /api/auth/* to this host. Keep `pnpm dev` running so both " +
				"Vite and `convex dev` stay up — do not use `vite dev` alone if you need sign-in.\n"
		);
	} catch (e) {
		clearTimeout(t);
		const err = e instanceof Error ? e : new Error(String(e));
		console.error(`❌ Could not reach ${sessionUrl.origin}`);
		console.error(`   ${err.name}: ${err.message}`);
		console.error(
			"\n   Fix:\n" +
				"   • Run `pnpm dev` (starts `convex dev` + `vite dev` together).\n" +
				"   • Ensure `PUBLIC_CONVEX_URL` is the deployment `convex dev` uses (`https://…convex.cloud` → auth uses derived `https://…convex.site`).\n" +
				"   • If realtime uses a local URL, set `PUBLIC_CONVEX_SITE_URL` to the matching `https://…convex.site` — see docs/product/authentication.md.\n"
		);
		process.exit(1);
	}
}

main();
