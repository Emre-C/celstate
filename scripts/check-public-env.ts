/**
 * Validates public/env contract for SvelteKit + Convex + WorkOS AuthKit.
 *
 * - Local: run `pnpm check:public-env` (reads `.env` / `.env.local` + shell).
 * - CI: same script; GitHub Actions must set the same PUBLIC_* names as Vercel
 *   so `vite build` and static `$env/static/public` imports succeed.
 *
 * See docs/runbooks/PUBLIC-ENV-CHECKLIST.md
 */

import { resolveConvexHttpSiteOrigin } from "../src/lib/server/convex-site-url.js";
import { mergedEnvForScripts } from "./lib/env-files.js";

function isCi(): boolean {
	return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

function assertSiteUrl(name: string, value: string | undefined): string {
	const v = value?.trim();
	if (!v) {
		throw new Error(`${name} is required (canonical URL of this SvelteKit app, origin only).`);
	}
	try {
		const u = new URL(v);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			throw new Error("protocol");
		}
		if (u.username || u.password || u.search || u.hash) {
			throw new Error("no userinfo/search/hash");
		}
		if (u.pathname !== "/" && u.pathname !== "") {
			throw new Error("path");
		}
		return u.origin;
	} catch {
		throw new Error(
			`${name} must be an origin-only http(s) URL (e.g. https://app.example.com or http://localhost:5173). Got: ${v}`
		);
	}
}

function validatePublicEnv(env: Record<string, string | undefined>): void {
	assertSiteUrl("PUBLIC_SITE_URL", env.PUBLIC_SITE_URL);

	const convex = env.PUBLIC_CONVEX_URL?.trim();
	if (!convex) {
		throw new Error(
			"PUBLIC_CONVEX_URL is required. Use your Convex deployment URL (https://…convex.cloud for cloud, or loopback for local realtime)."
		);
	}

	resolveConvexHttpSiteOrigin({
		publicConvexUrl: env.PUBLIC_CONVEX_URL,
		publicConvexSiteUrl: env.PUBLIC_CONVEX_SITE_URL
	});

	// PostHog: optional at runtime (init skips if key empty) but SvelteKit
	// `$env/static/public` needs the names to exist at build time — use placeholders in CI.
	const key = env.PUBLIC_POSTHOG_KEY?.trim();
	const host = env.PUBLIC_POSTHOG_HOST?.trim();
	if (!isCi() && !key) {
		console.warn(
			"⚠️  PUBLIC_POSTHOG_KEY is unset — analytics disabled locally (OK). " +
				"For production builds, set it on Vercel or use a placeholder in CI."
		);
	}
	if (key && host) {
		try {
			const u = new URL(host);
			if (u.protocol !== "http:" && u.protocol !== "https:") {
				throw new Error("protocol");
			}
		} catch {
			throw new Error(
				`PUBLIC_POSTHOG_HOST must be a valid http(s) URL when set. Got: ${host}`
			);
		}
	}
}

function main() {
	const env = mergedEnvForScripts();
	try {
		validatePublicEnv(env);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`❌ Public env validation failed:\n   ${msg}\n`);
		console.error("   See .env.example and docs/runbooks/PUBLIC-ENV-CHECKLIST.md\n");
		process.exit(1);
	}

	console.log("✅ Public env OK (PUBLIC_SITE_URL, PUBLIC_CONVEX_URL[+], PUBLIC_CONVEX_SITE_URL?).");
	if (isCi()) {
		console.log("   (CI) Values match what Vercel must expose for Preview + Production builds.\n");
	}
}

main();

