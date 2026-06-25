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

import { spawn, spawnSync } from "node:child_process";

function killProcessTree(child) {
	if (!child.pid) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
		return;
	}
	child.kill("SIGTERM");
}

function run(label, command, args, timeoutMs) {
	return new Promise((resolve) => {
		console.error(`\n▶ ${label}: ${command} ${args.join(" ")}\n`);
		const child = spawn(command, args, {
			shell: process.platform === "win32",
			stdio: ["ignore", "inherit", "inherit"]
		});
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			killProcessTree(child);
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timeout);
			resolve({ label, status: 1, error, timedOut: false });
		});
		child.on("close", (status, signal) => {
			clearTimeout(timeout);
			resolve({ label, status, signal, timedOut });
		});
	});
}

async function runStep(label, command, args, timeoutMs) {
	const result = await run(label, command, args, timeoutMs);
	if (result.timedOut) {
		console.error(`\n❌ Failed: ${label} timed out after ${Math.round(timeoutMs / 1000)}s\n`);
		process.exit(124);
	}
	if (result.error) {
		console.error(`\n❌ Failed: ${label}: ${result.error.message}\n`);
		process.exit(1);
	}
	if (result.status !== 0) {
		const suffix = result.signal ? ` (signal ${result.signal})` : "";
		console.error(`\n❌ Failed: ${label} (exit ${result.status ?? "unknown"}${suffix})\n`);
		process.exit(result.status ?? 1);
	}
}

await runStep("Secrets → Convex prod", "pnpm", ["secrets:sync:convex"], 240_000);
await runStep("Secrets → Vercel production", "pnpm", ["secrets:sync:vercel"], 300_000);
await runStep("Validate Doppler Clerk env", "node", ["scripts/checks/verify-doppler-kit-env.mjs"], 30_000);
await runStep("Convex deploy (prod)", "pnpm", ["deploy:convex:prod"], 420_000);
await runStep("Vercel deploy (prod)", "pnpm", ["exec", "vercel", "deploy", "--prod", "--yes"], 600_000);
await runStep("Production verification", "pnpm", ["verify:production"], 900_000);

console.error("\n✅ Release pipeline finished OK.\n");
