#!/usr/bin/env node
/**
 * Single production release gate (local operator machine):
 *   1. Sync Doppler → Convex prod + Vercel production env
 *   2. Validate Doppler prd has Clerk (+ optional Sentry) values
 *   3. Deploy Convex production
 *   4. Deploy Vercel production
 *   5. Run production verification (`pnpm verify:production`)
 *
 * Any step failing exits non-zero — treat as **do not cut traffic** until fixed,
 * then repeat or roll back Vercel / Convex per runbooks.
 *
 * Requires: pnpm, Convex CLI auth, Vercel CLI auth, Doppler CLI auth, verification secrets in env.
 */

import { spawnSync } from "node:child_process";

const shell = process.platform === "win32";

function run(label, command, args) {
	console.error(`\n▶ ${label}: ${command} ${args.join(" ")}\n`);
	const r = spawnSync(command, args, { stdio: "inherit", shell });
	if (r.status !== 0) {
		console.error(`\n❌ Failed: ${label} (exit ${r.status ?? "unknown"})\n`);
		process.exit(r.status ?? 1);
	}
}

run("Secrets → Convex prod", "pnpm", ["secrets:sync:convex"]);
run("Secrets → Vercel production", "pnpm", ["secrets:sync:vercel"]);
run("Validate Doppler Clerk env", "node", ["scripts/checks/verify-doppler-kit-env.mjs"]);
run("Convex deploy (prod)", "pnpm", ["exec", "convex", "deploy", "--yes"]);
run("Vercel deploy (prod)", "pnpm", ["exec", "vercel", "deploy", "--prod", "--yes"]);
run("Production verification", "pnpm", ["verify:production"]);

console.error("\n✅ Release pipeline finished OK.\n");
