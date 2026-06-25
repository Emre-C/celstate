#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VALID_TARGETS = new Set(["dev", "prod"]);
const VALID_TYPECHECK = new Set(["enable", "try", "disable"]);
const TIMEOUT_EXIT_CODE = 124;
const DEFAULT_TIMEOUT_MS = {
	dev: 120_000,
	prod: 420_000
};
const DEFAULT_TYPECHECK = {
	dev: "disable",
	prod: "try"
};

function printUsage() {
	console.error(`Usage: node scripts/ops/deploy-convex.mjs --target=dev|prod [--timeout-ms=N] [--typecheck=enable|try|disable] [--dry-run] [--message=TEXT]

Package scripts:
  pnpm deploy:convex       Push local Convex code to the dev deployment once, then exit
  pnpm deploy:convex:dev   Same as deploy:convex
  pnpm deploy:convex:prod  Deploy Convex code to production with a bounded watchdog`);
}

function parseArgs(argv) {
	const parsed = {
		dryRun: false
	};

	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		}
		if (arg === "--dry-run") {
			parsed.dryRun = true;
			continue;
		}
		if (!arg.startsWith("--")) {
			throw new Error(`Unexpected positional argument: ${arg}`);
		}
		const equals = arg.indexOf("=");
		if (equals < 3) {
			throw new Error(`Expected --name=value argument, got ${arg}`);
		}
		const name = arg.slice(2, equals);
		const value = arg.slice(equals + 1);
		if (name === "target") {
			parsed.target = value;
		} else if (name === "timeout-ms") {
			parsed.timeoutMs = Number(value);
		} else if (name === "typecheck") {
			parsed.typecheck = value;
		} else if (name === "message") {
			parsed.message = value;
		} else {
			throw new Error(`Unknown argument: --${name}`);
		}
	}

	if (!VALID_TARGETS.has(parsed.target)) {
		throw new Error("--target=dev|prod is required");
	}
	if (parsed.timeoutMs !== undefined && (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs < 1_000)) {
		throw new Error("--timeout-ms must be an integer >= 1000");
	}
	if (parsed.typecheck !== undefined && !VALID_TYPECHECK.has(parsed.typecheck)) {
		throw new Error("--typecheck must be enable, try, or disable");
	}
	if (parsed.dryRun && parsed.target === "dev") {
		throw new Error("--dry-run is only supported for --target=prod because convex dev has no dry-run mode");
	}

	return parsed;
}

function stripInlineComment(value) {
	const hashIndex = value.indexOf("#");
	return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
}

function parseDotenvValue(rawValue) {
	const trimmed = rawValue.trim();
	if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim();
	}
	return stripInlineComment(trimmed);
}

function readLocalConvexSelectors() {
	const selectors = {};
	for (const fileName of [".env", ".env.local"]) {
		const filePath = join(process.cwd(), fileName);
		if (!existsSync(filePath)) continue;
		const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const match = /^(?:export\s+)?(CONVEX_DEPLOYMENT|CONVEX_DEPLOY_KEY)\s*=\s*(.*)$/.exec(trimmed);
			if (!match) continue;
			selectors[match[1]] = parseDotenvValue(match[2]);
		}
	}
	return selectors;
}

function deploymentKeyKind(value) {
	const trimmed = value?.trim();
	if (!trimmed) return "none";
	if (trimmed.startsWith("prod:")) return "prod";
	if (trimmed.startsWith("dev:")) return "dev";
	if (trimmed.startsWith("preview:")) return "preview";
	return "other";
}

function encodeEnvValue(value) {
	return JSON.stringify(value).replace(/\u2028|\u2029/g, "");
}

function buildConvexSelector(target) {
	const localSelectors = readLocalConvexSelectors();
	const deployment = stripInlineComment(process.env.CONVEX_DEPLOYMENT ?? localSelectors.CONVEX_DEPLOYMENT ?? "");
	const deployKey = (process.env.CONVEX_DEPLOY_KEY ?? localSelectors.CONVEX_DEPLOY_KEY ?? "").trim();
	const keyKind = deploymentKeyKind(deployKey);

	if (target === "dev" && (keyKind === "prod" || keyKind === "preview")) {
		throw new Error(`Refusing dev deploy while CONVEX_DEPLOY_KEY is a ${keyKind} deploy key.`);
	}
	if (target === "prod" && (keyKind === "dev" || keyKind === "preview")) {
		throw new Error(`Refusing production deploy while CONVEX_DEPLOY_KEY is a ${keyKind} deploy key.`);
	}

	const selector = {};
	if (deployKey) {
		selector.CONVEX_DEPLOY_KEY = deployKey;
	} else if (deployment) {
		selector.CONVEX_DEPLOYMENT = deployment;
	}
	return selector;
}

function createSelectorEnvFile(selector) {
	const dir = mkdtempSync(join(tmpdir(), "celstate-convex-deploy-"));
	const filePath = join(dir, ".env");
	const body = Object.entries(selector)
		.map(([name, value]) => `${name}=${encodeEnvValue(value)}`)
		.join("\n") + "\n";
	writeFileSync(filePath, body, "utf8");
	return { dir, filePath };
}

function buildEnv() {
	return {
		...process.env,
		CI: process.env.CI || "1",
		CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE || "celstate-deploy"
	};
}

function buildConvexArgs(options, envFilePath) {
	const typecheck = options.typecheck ?? DEFAULT_TYPECHECK[options.target];
	if (options.target === "dev") {
		return ["exec", "convex", "dev", "--once", "--tail-logs", "disable", "--typecheck", typecheck, "--env-file", envFilePath];
	}

	const args = ["exec", "convex", "deploy", "--yes", "--typecheck", typecheck, "--codegen", "enable", "--env-file", envFilePath];
	if (options.dryRun) {
		args.push("--dry-run");
	}
	if (options.message) {
		args.push("--message", options.message);
	}
	return args;
}

function quote(value) {
	return /\s/.test(value) ? JSON.stringify(value) : value;
}

function printFailureHints(target) {
	console.error("\nHints:");
	if (target === "dev") {
		console.error("- Use pnpm deploy:convex for a one-shot dev push; pnpm exec convex dev is a watcher and intentionally does not exit.");
		console.error("- If the CLI asks to configure a project, run the interactive setup once outside the deploy wrapper.");
	} else {
		console.error("- Production deploy requires Convex CLI auth or a production CONVEX_DEPLOY_KEY.");
		console.error("- Keep secrets in Doppler and inspect names only with pnpm secrets:diff; do not run convex env list.");
	}
}

function killProcessTree(child) {
	if (!child.pid) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
			stdio: "ignore"
		});
		return;
	}
	child.kill("SIGTERM");
}

function runChild(command, args, env, timeoutMs) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			env,
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
			resolve({ status: 1, error, timedOut: false });
		});
		child.on("close", (status, signal) => {
			clearTimeout(timeout);
			resolve({ status, signal, timedOut });
		});
	});
}

async function run() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		printUsage();
		process.exit(2);
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[options.target];
	let selector;
	try {
		selector = buildConvexSelector(options.target);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}

	const selectorEnvFile = createSelectorEnvFile(selector);
	try {
		const convexArgs = buildConvexArgs(options, selectorEnvFile.filePath);
		const commandLine = ["pnpm", ...convexArgs].map((value) => value === selectorEnvFile.filePath ? "<selector-env-file>" : quote(value)).join(" ");
		console.error(`\n▶ Convex ${options.target} deploy: ${commandLine}`);
		console.error(`▶ Watchdog timeout: ${Math.round(timeoutMs / 1000)}s\n`);

		const env = buildEnv();
		const result = await runChild("pnpm", convexArgs, env, timeoutMs);
		if (result.timedOut) {
			console.error(`\n❌ Convex ${options.target} deploy timed out after ${Math.round(timeoutMs / 1000)}s.`);
			printFailureHints(options.target);
			process.exit(TIMEOUT_EXIT_CODE);
		}
		if (result.error) {
			console.error(`\n❌ Convex ${options.target} deploy failed to start: ${result.error.message}`);
			printFailureHints(options.target);
			process.exit(1);
		}
		if (result.status !== 0) {
			const suffix = result.signal ? ` (signal ${result.signal})` : "";
			console.error(`\n❌ Convex ${options.target} deploy failed with exit ${result.status ?? "unknown"}${suffix}.`);
			printFailureHints(options.target);
			process.exit(result.status ?? 1);
		}

		console.error(`\n✅ Convex ${options.target} deploy finished.\n`);
	} finally {
		rmSync(selectorEnvFile.dir, { recursive: true, force: true });
	}
}

await run();
