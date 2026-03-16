/**
 * Validates Stripe environment variables on the Convex production deployment.
 *
 * Usage:  pnpm check:stripe-env
 *
 * Runs `npx convex env list --prod` and checks that all required Stripe vars
 * exist and follow the expected format (live keys, https SITE_URL, etc.).
 */

import { execSync } from "node:child_process";

interface EnvCheck {
  name: string;
  required: boolean;
  validate: (value: string) => string | null;
}

const checks: EnvCheck[] = [
  {
    name: "SITE_URL",
    required: true,
    validate: (v) => {
      try {
        const url = new URL(v);
        if (url.protocol !== "https:") return "Must use https:// in production";
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
          return "Must not be localhost in production";
        return null;
      } catch {
        return "Not a valid URL";
      }
    },
  },
  {
    name: "STRIPE_SECRET_KEY",
    required: true,
    validate: (v) =>
      v.startsWith("sk_live_") ? null : `Expected sk_live_ prefix, got "${v.slice(0, 12)}..."`,
  },
  {
    name: "STRIPE_PRICE_STARTER",
    required: true,
    validate: (v) =>
      v.startsWith("price_") ? null : `Expected price_ prefix, got "${v.slice(0, 12)}..."`,
  },
  {
    name: "STRIPE_PRICE_PRO",
    required: true,
    validate: (v) =>
      v.startsWith("price_") ? null : `Expected price_ prefix, got "${v.slice(0, 12)}..."`,
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    required: true,
    validate: (v) =>
      v.startsWith("whsec_") ? null : `Expected whsec_ prefix, got "${v.slice(0, 12)}..."`,
  },
  {
    name: "BETTER_AUTH_SECRET",
    required: true,
    validate: (v) => (v.length >= 16 ? null : "Suspiciously short (< 16 chars)"),
  },
];

function main() {
  console.log("🔍 Checking Convex production environment variables...\n");

  let raw: string;
  try {
    raw = execSync("npx convex env list --prod", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    console.error("❌ Failed to run `npx convex env list --prod`. Is Convex CLI authenticated?");
    console.error((err as Error).message);
    process.exit(1);
  }

  // Parse "NAME=VALUE" lines from convex env list output
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
    console.error(`❌ ${failures} check(s) failed. Fix the Convex production env vars before deploying.`);
    process.exit(1);
  }

  console.log("✅ All Stripe production environment checks passed.");
}

main();
