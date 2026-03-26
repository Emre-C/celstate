/**
 * Load `.env` then `.env.local` from cwd (same merge order as typical tooling).
 * Does not parse shell escapes; sufficient for our validation scripts.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(name: string): Record<string, string> {
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

/** Merge: `.env`, then `.env.local`, then `process.env` (shell wins). */
export function mergedEnvForScripts(): Record<string, string | undefined> {
	return {
		...loadEnvFile(".env"),
		...loadEnvFile(".env.local"),
		...process.env
	};
}
