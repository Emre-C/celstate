/**
 * Verifies the SvelteKit auth endpoints are healthy on the app origin.
 *
 * Checks:
 *   1. /api/auth/session — returns valid Clerk session JSON
 *   2. /api/auth/convex-ready — Convex auth boundary is reachable and responds
 *
 * Usage: `pnpm check:convex-auth`
 *
 * Loads `.env` then `.env.local` from the repo root, then overlays `process.env`.
 * Uses `PUBLIC_SITE_URL` as the fetch origin (the Celstate web app, not `*.convex.site`).
 */

import { mergedEnvForScripts } from "../lib/env-files.js";

async function checkSession(base: URL): Promise<void> {
	const sessionUrl = new URL("/api/auth/session", base);
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), 12_000);

	try {
		const res = await fetch(sessionUrl, {
			method: "GET",
			signal: controller.signal,
			headers: { accept: "application/json" },
		});
		clearTimeout(t);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
		if (!ct.includes("application/json")) {
			throw new Error(`unexpected content-type: ${ct || "missing"}`);
		}
		const body = (await res.json()) as { authenticated?: unknown };
		if (typeof body.authenticated !== "boolean") {
			throw new Error("response JSON missing boolean `authenticated`");
		}
		console.log(`✅ ${sessionUrl.href} (authenticated=${body.authenticated})`);
	} catch (e) {
		clearTimeout(t);
		const err = e instanceof Error ? e : new Error(String(e));
		console.error(`❌ ${sessionUrl.href} — ${err.name}: ${err.message}`);
		throw err;
	}
}

async function checkConvexReady(base: URL): Promise<void> {
	const readyUrl = new URL("/api/auth/convex-ready", base);
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), 12_000);

	try {
		const res = await fetch(readyUrl, {
			method: "GET",
			signal: controller.signal,
			headers: { accept: "application/json" },
		});
		clearTimeout(t);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
		if (!ct.includes("application/json")) {
			throw new Error(`unexpected content-type: ${ct || "missing"}`);
		}
		const body = (await res.json()) as { ok?: unknown };
		if (body.ok !== true) {
			throw new Error(`response ok=${String(body.ok)} (expected true)`);
		}
		console.log(`✅ ${readyUrl.href} (ok=true)`);
	} catch (e) {
		clearTimeout(t);
		const err = e instanceof Error ? e : new Error(String(e));
		console.error(`❌ ${readyUrl.href} — ${err.name}: ${err.message}`);
		throw err;
	}
}

async function main() {
	console.log("Checking auth endpoints on PUBLIC_SITE_URL…\n");

	const env = mergedEnvForScripts();
	const raw = env.PUBLIC_SITE_URL?.trim();
	if (!raw) {
		console.error("❌ PUBLIC_SITE_URL is required.\n");
		process.exit(1);
	}

	let base: URL;
	try {
		base = new URL(raw);
		if (base.pathname !== "/" && base.pathname !== "") {
			throw new Error("PUBLIC_SITE_URL must be origin-only");
		}
	} catch (e) {
		console.error(`❌ PUBLIC_SITE_URL invalid: ${e instanceof Error ? e.message : String(e)}\n`);
		process.exit(1);
	}

	let failed = false;
	try {
		await checkSession(base);
	} catch {
		failed = true;
	}

	try {
		await checkConvexReady(base);
	} catch {
		failed = true;
	}

	console.log("");
	if (failed) {
		console.error("Run `pnpm dev` so SvelteKit is up, or point PUBLIC_SITE_URL at a reachable deployment.\n");
		process.exit(1);
	}
}

main();
