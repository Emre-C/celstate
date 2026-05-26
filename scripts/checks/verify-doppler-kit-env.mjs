#!/usr/bin/env node
/**
 * Validate Doppler **prd** contains the WorkOS AuthKit server secrets before a prod release.
 * Reads vault JSON in-memory only (never prints values). Used by `scripts/release-production.mjs`.
 *
 * Usage:
 *   node scripts/verify-doppler-kit-env.mjs [--project=celstate] [--config=prd]
 */

import { downloadSecrets, findDopplerBinary } from "./secrets/lib/doppler.mjs";

/** @param {string} name @param {string | undefined} value @returns {string | null} */
function assertNonEmpty(name, value) {
  const v = value?.trim();
  if (!v) return `missing ${name}`;
  if (name === "WORKOS_CLIENT_ID" && !v.startsWith("client_")) {
    return `${name} must start with client_`;
  }
  if (name === "WORKOS_API_KEY" && !v.startsWith("sk_")) {
    return `${name} must start with sk_`;
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
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
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
    console.error(`❌ Doppler kit env (${project}/${config}) validation failed:\n`);
    for (const e of errors) console.error(`   - ${e}`);
    console.error("\n   Fix names in Doppler, then re-run release.\n");
    process.exit(1);
  }

  console.error(
    `✅ Doppler ${project}/${config}: WorkOS AuthKit server secrets present (SENTRY_DSN optional).\n`,
  );
}

main();
