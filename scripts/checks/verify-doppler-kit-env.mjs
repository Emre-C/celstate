#!/usr/bin/env node
/**
 * Validate Doppler **prd** contains the Clerk Auth server secrets before a prod release.
 * Reads vault JSON in-memory only (never prints values). Used by `scripts/release-production.mjs`.
 *
 * Usage:
 *   node scripts/verify-doppler-kit-env.mjs [--project=celstate] [--config=prd]
 */

import { downloadSecrets, findDopplerBinary } from "../secrets/lib/doppler.mjs";

/** @param {string} name @param {string | undefined} value @returns {string | null} */
function assertNonEmpty(name, value) {
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

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (const a of argv) {
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 2) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (a.startsWith("--")) {
      out[a.slice(2)] = true;
    } else {
      console.error(`Unexpected positional arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const REQUIRED_KIT = /** @type {const} */ ([
  "CLERK_SECRET_KEY",
  "PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_JWT_ISSUER_DOMAIN",
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = typeof args.project === "string" ? args.project : "celstate";
  const config = typeof args.config === "string" ? args.config : "prd";

  let bin;
  try {
    bin = findDopplerBinary();
  } catch (e) {
    console.error(`❌ ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  /** @type {Record<string, string>} */
  let secrets;
  try {
    secrets = downloadSecrets(bin, { project, config });
  } catch (e) {
    console.error(`❌ Failed to read Doppler secrets for ${project}/${config}:`);
    console.error(`   ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  const errors = [];
  for (const name of REQUIRED_KIT) {
    const err = assertNonEmpty(name, secrets[name]);
    if (err) errors.push(err);
  }

  const dsn = secrets.SENTRY_DSN?.trim();
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
    console.error(`❌ Doppler Clerk env (${project}/${config}) validation failed:\n`);
    for (const e of errors) console.error(`   - ${e}`);
    console.error("\n   Fix names in Doppler, then re-run release.\n");
    process.exit(1);
  }

  console.error(
    `✅ Doppler ${project}/${config}: Clerk Auth server secrets present (SENTRY_DSN optional).\n`,
  );
}

main();
