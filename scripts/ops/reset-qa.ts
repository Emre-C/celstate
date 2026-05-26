/**
 * Resets the allowlisted QA test user on the prod Convex deployment so the
 * next Google sign-in yields a fresh user with initial credits.
 *
 * Usage:  pnpm reset-qa
 *
 * The target email is hardcoded to the dedicated QA account
 * (ycoklar@gmail.com), which must also appear in QA_USER_RESET_ALLOWED_EMAILS
 * on the prod deployment. The gate secret is read from the prod Convex env
 * (QA_USER_RESET_SECRET) via the Convex CLI so there is no local secret file
 * to manage — the deployment env is the single source of truth.
 *
 * Prereqs: logged into the Convex CLI with prod access
 * (`pnpm exec convex login`) and both QA_USER_RESET_SECRET and
 * QA_USER_RESET_ALLOWED_EMAILS set on the prod deployment.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const QA_EMAIL = "ycoklar@gmail.com";
const CONVEX_BIN = path.resolve(
	process.cwd(),
	"node_modules",
	".bin",
	process.platform === "win32" ? "convex.cmd" : "convex"
);

function runConvex(args: string[], capture = false): string {
	const result = spawnSync(CONVEX_BIN, args, {
		encoding: "utf-8",
		stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit"
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
	return capture ? (result.stdout ?? "").trim() : "";
}

function main() {
	console.log("Reading QA_USER_RESET_SECRET from Convex prod env...");
	const secret = runConvex(["env", "get", "QA_USER_RESET_SECRET", "--prod"], true);
	if (!secret) {
		console.error(
			"QA_USER_RESET_SECRET is not set on Convex prod.\n" +
				"Set it with: pnpm exec convex env set QA_USER_RESET_SECRET <value> --prod"
		);
		process.exit(1);
	}

	const payload = JSON.stringify({ secret, email: QA_EMAIL });
	console.log(`Resetting QA user ${QA_EMAIL} on prod...\n`);
	runConvex(["run", "--prod", "qaUserReset:resetAllowlistedTestUser", payload]);
	console.log(
		"\nDone. Sign in with Google again for a fresh account + initial credits."
	);
}

main();
