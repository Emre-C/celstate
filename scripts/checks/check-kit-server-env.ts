/**
 * Validates Clerk Auth + optional server Sentry env for SvelteKit (Vercel runtime).
 *
 * Usage (recommended before prod deploy):
 *   doppler run --project celstate --config prd -- pnpm check:kit-server-env
 *
 * Local dev:
 *   pnpm check:kit-server-env
 *   (reads `.env` / `.env.local` via mergedEnvForScripts + process.env)
 */

import { mergedEnvForScripts } from "../lib/env-files.js";

const REQUIRED_KIT = [
	"CLERK_SECRET_KEY",
	"PUBLIC_CLERK_PUBLISHABLE_KEY",
	"CLERK_JWT_ISSUER_DOMAIN",
] as const;

function assertNonEmpty(name: string, value: string | undefined): string | null {
	const v = value?.trim();
	if (!v) return `missing ${name}`;
	if (name === "CLERK_SECRET_KEY" && !v.startsWith("sk_test_") && !v.startsWith("sk_live_")) {
		return `${name} must start with sk_test_ or sk_live_`;
	}
	if (name === "PUBLIC_CLERK_PUBLISHABLE_KEY" && !v.startsWith("pk_test_") && !v.startsWith("pk_live_")) {
		return `${name} must start with pk_test_ or pk_live_`;
	}
	if (name === "CLERK_JWT_ISSUER_DOMAIN") {
		try {
			const u = new URL(v);
			if (u.protocol !== "https:") return `${name}: must use https://`;
			if (u.username || u.password || u.hash) return `${name}: must not include userinfo or hash`;
		} catch {
			return `${name}: not a valid URL`;
		}
	}
	return null;
}

function main() {
	const env = mergedEnvForScripts();
	const errors: string[] = [];

	for (const name of REQUIRED_KIT) {
		const err = assertNonEmpty(name, env[name]);
		if (err) errors.push(err);
	}

	const dsn = env.SENTRY_DSN?.trim();
	if (dsn) {
		try {
			const u = new URL(dsn);
			if (u.protocol !== "https:" && u.protocol !== "http:") {
				errors.push("SENTRY_DSN: invalid URL");
			}
		} catch {
			errors.push("SENTRY_DSN: not a valid URL");
		}
	}

	if (errors.length > 0) {
		console.error("❌ SvelteKit server env (Clerk) validation failed:\n");
		for (const e of errors) console.error(`   - ${e}`);
		console.error("\n   Set names in Doppler, then `pnpm secrets:sync:vercel`.\n");
		process.exit(1);
	}

	console.log("✅ Clerk server env OK (required CLERK_* present; SENTRY_DSN optional).\n");
}

main();
