/**
 * Validates PostHog environment variables on the Convex production deployment.
 *
 * Usage:  pnpm check:posthog-env
 *
 * Server-side `credits_purchase_completed` (Stripe webhook → `src/convex/http.ts`) uses
 * @posthog/convex with POSTHOG_API_KEY and POSTHOG_HOST. If these are missing or wrong,
 * purchase funnels show zero for server events while browser events may still work — or vice
 * versa if Vercel `PUBLIC_POSTHOG_KEY` points at a different project.
 *
 * See: docs/features/observability.yaml, docs/implementation/OBSERVABILITY-FOLLOWUPS.md §2.
 */

import { execSync } from "node:child_process";

interface EnvCheck {
  name: string;
  required: boolean;
  validate: (value: string) => string | null;
}

const US_INGEST = "https://us.i.posthog.com";
const EU_INGEST = "https://eu.i.posthog.com";

const checks: EnvCheck[] = [
  {
    name: "POSTHOG_API_KEY",
    required: true,
    validate: (v) =>
      v.startsWith("phc_")
        ? null
        : `Expected phc_ project key (same value as PUBLIC_POSTHOG_KEY on Vercel), got "${v.slice(0, 8)}..."`,
  },
  {
    name: "POSTHOG_HOST",
    required: true,
    validate: (v) => {
      try {
        const url = new URL(v);
        if (url.protocol !== "https:") return "Must use https://";
        const host = url.hostname;
        if (host === "us.i.posthog.com" || host === "eu.i.posthog.com") return null;
        return (
          `Must be ${US_INGEST} (US) or ${EU_INGEST} (EU) for Convex server ingest. ` +
          "Do not set this to the browser reverse-proxy host (PUBLIC_POSTHOG_HOST on Vercel)."
        );
      } catch {
        return "Not a valid URL";
      }
    },
  },
];

function main() {
  console.log("🔍 Checking Convex production PostHog variables (server capture)...\n");

  let raw: string;
  try {
    raw = execSync("npx convex env list --prod", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    console.error("❌ Failed to run `npx convex env list --prod`. Is Convex CLI authenticated?");
    console.error((err as Error).message);
    process.exit(1);
  }

  const envMap = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      envMap.set(line.slice(0, eqIndex).trim(), line.slice(eqIndex + 1).trim());
    }
  }

  let failures = 0;

  for (const check of checks) {
    const value = envMap.get(check.name);

    if (!value) {
      if (check.required) {
        console.error(`  ❌ ${check.name}: MISSING`);
        failures++;
      } else {
        console.log(`  ⏭️  ${check.name}: not set (optional)`);
      }
      continue;
    }

    const error = check.validate(value);
    if (error) {
      console.error(`  ❌ ${check.name}: ${error}`);
      failures++;
    } else {
      console.log(`  ✅ ${check.name}`);
    }
  }

  console.log();

  if (failures > 0) {
    console.error(
      `❌ ${failures} check(s) failed. Without POSTHOG_API_KEY / correct POSTHOG_HOST, ` +
        "Stripe webhook events such as credits_purchase_completed will not reach PostHog.\n",
    );
    process.exit(1);
  }

  console.log("✅ Convex production PostHog checks passed.");
  console.log(
    "   Reminder: set PUBLIC_POSTHOG_KEY on Vercel to the same phc_ project key for aligned browser + server analytics.\n",
  );
}

main();
