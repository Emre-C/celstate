/**
 * Validates WorkOS AuthKit + optional server Sentry env for SvelteKit (Vercel runtime).
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
	"WORKOS_CLIENT_ID",
	"WORKOS_API_KEY",
	"WORKOS_REDIRECT_URI",
	"WORKOS_COOKIE_PASSWORD",
] as const;

function assertNonEmpty(name: string, value: string | undefined): string | null {
	const v = value?.trim();
	if (!v) return `missing ${name}`;
	if (name === "WORKOS_CLIENT_ID" && !v.startsWith("client_")) {
		return `${name} must start with client_`;
	}
	if (name === "WORKOS_API_KEY" && !v.startsWith("sk_")) {
		return `${name} must start with sk_ (test or live)`;
	}
	if (name === "WORKOS_REDIRECT_URI") {
		try {
			const u = new URL(v);
			if (u.username || u.password || u.hash) return `${name}: must not include userinfo or hash`;
		} catch {
			return `${name}: not a valid URL`;
		}
	}
	if (name === "WORKOS_COOKIE_PASSWORD" && v.length < 32) {
		return `${name}: must be at least 32 characters`;
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
		console.error("❌ SvelteKit server env (WorkOS AuthKit) validation failed:\n");
		for (const e of errors) console.error(`   - ${e}`);
		console.error("\n   Set names in Doppler, then `pnpm secrets:sync:vercel`.\n");
		process.exit(1);
	}

	console.log("✅ WorkOS AuthKit server env OK (required WORKOS_* present; SENTRY_DSN optional).\n");
}

main();
