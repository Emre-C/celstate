#!/usr/bin/env node
// One-shot tool: bootstrap Doppler `dev` from legacy local env files plus a
// curated subset of values reused from Doppler `prd`. Designed for the
// migration moment when local development was still relying on `.env` /
// `.env.local` and Doppler `dev` is empty.
//
// Idempotent: re-running re-uploads the same payload (Doppler upserts).
//
// Usage:
//   node scripts/secrets/bootstrap-dev.mjs              # apply
//   node scripts/secrets/bootstrap-dev.mjs --dry-run    # show names only
//
// Threat-model invariants:
//   - Never echoes any secret value to stdout / stderr.
//   - Reads `.env` and `.env.local` from disk silently, parses in memory.
//   - Pulls a curated subset of values from Doppler prd in memory only;
//     never serializes them anywhere except into the dev upload temp file.
//   - Temp file is mode 0o600, deleted in a `finally` block.
//
// What ends up in Doppler dev:
//   * Auto-rotated names (JWT, Better Auth, Verification Runner, QA Reset)
//     are SKIPPED here. Run `pnpm secrets:rotate:dev` afterwards.
//   * Apple OAuth credentials are NOT required for SITE_URL=http://localhost
//     (see src/lib/auth/config.ts), so they are SKIPPED.
//   * Legacy `.env` names are renamed to canonical names where applicable.
//   * Live-mode Stripe values, deprecated Gemini/Vertex API keys, and other
//     dead names are DROPPED.

import { readFileSync, existsSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { findDopplerBinary, runDoppler, downloadSecrets } from "./lib/doppler.mjs";

const dryRun = process.argv.includes("--dry-run");

// Names auto-rotatable via `pnpm secrets:rotate:dev`. Skipped during bootstrap
// so the rotate step generates fresh dev values without races.
const AUTO_ROTATED = new Set([
  "JWT_PRIVATE_KEY",
  "JWKS",
  "BETTER_AUTH_SECRET",
  "VERIFICATION_RUNNER_SECRET",
  "QA_USER_RESET_SECRET",
]);

// Curated subset of values copied verbatim from Doppler prd into Doppler dev.
// Sharing these with prd is a deliberate trade-off for solo/low-traffic dev.
// Split into dedicated dev resources if the dev environment ever broadens.
const REUSE_FROM_PRD = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "VERTEX_AI_SERVICE_ACCOUNT_JSON",
  "VERTEX_AI_PROJECT_ID",
  "VERTEX_AI_LOCATION",
  "POSTHOG_API_KEY",
  "POSTHOG_HOST",
  "SENTRY_DSN",
];

// Mapping from legacy .env / .env.local names to canonical 2026 names.
const LEGACY_RENAMES = /** @type {const} */ ({
  STRIPE_SANDBOX_SECRET_KEY: "STRIPE_SECRET_KEY",
});

// Names we deliberately drop from .env (legacy / live-mode / deprecated).
// Live Stripe values must never reach the dev deployment. GEMINI_API_KEY and
// VERTEX_API_KEY are obsolete since the Vertex SA migration.
const DROP_NAMES = new Set([
  "GEMINI_API_KEY",
  "VERTEX_API_KEY",
  "STRIPE_SECRET_KEY_LIVE",
  "STRIPE_PRICE_STARTER_LIVE",
  "STRIPE_PRICE_PRO_LIVE",
  "STRIPE_WEBHOOK_SECRET_LIVE",
  "STRIPE_SANDBOX_PUBLISHING_KEY",
  // Vite-side only; not needed inside Convex dev. Doppler dev still surfaces
  // it via `doppler run`, but we don't want to put a Vercel API token into
  // a Convex deployment.
  "VERCEL_TOKEN",
]);

// Names that are required for the dev deployment to function. We use this to
// flag remaining gaps after bootstrap so the operator knows what to add by
// hand. Auto-rotated names are excluded because the rotate step handles them.
const REQUIRED_FOR_DEV = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "PUBLIC_CONVEX_URL",
  "PUBLIC_POSTHOG_HOST",
  "PUBLIC_POSTHOG_KEY",
  "PUBLIC_SITE_URL",
  "SITE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_STARTER",
  "VERTEX_AI_SERVICE_ACCOUNT_JSON",
  "VERTEX_AI_PROJECT_ID",
];

/**
 * Parse a dotenv buffer. Supports `KEY=value`, `KEY="value"`, `KEY='value'`,
 * and `export KEY=value`. Does not implement Vite-specific interpolation.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseDotenv(content) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, "");
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    out[m[1]] = value;
  }
  return out;
}

const bin = findDopplerBinary();

// ---------------------------------------------------------------------------
// 1. Read legacy local files (silently).
// ---------------------------------------------------------------------------
/** @type {Record<string, string>} */
const legacy = {};
const sources = [];
for (const path of [".env", ".env.local"]) {
  if (!existsSync(path)) continue;
  Object.assign(legacy, parseDotenv(readFileSync(path, "utf8")));
  sources.push(path);
}

// ---------------------------------------------------------------------------
// 2. Pull curated subset of values from Doppler prd (silently, in memory).
// ---------------------------------------------------------------------------
const prdAll = downloadSecrets(bin, { project: "celstate", config: "prd" });
/** @type {Record<string, string>} */
const prdSubset = {};
const prdGaps = [];
for (const name of REUSE_FROM_PRD) {
  if (name in prdAll && prdAll[name]) {
    prdSubset[name] = prdAll[name];
  } else {
    prdGaps.push(name);
  }
}

// ---------------------------------------------------------------------------
// 3. Build dev payload.
// ---------------------------------------------------------------------------
/** @type {Record<string, string>} */
const devPayload = {};

// 3a. Reuse from prd.
Object.assign(devPayload, prdSubset);

// 3b. Pull from .env / .env.local with renames + drops.
for (const [name, value] of Object.entries(legacy)) {
  if (DROP_NAMES.has(name)) continue;
  if (AUTO_ROTATED.has(name)) continue;
  if (name.startsWith("DOPPLER_")) continue;
  const canonical =
    /** @type {keyof typeof LEGACY_RENAMES} */ (name) in LEGACY_RENAMES
      ? LEGACY_RENAMES[/** @type {keyof typeof LEGACY_RENAMES} */ (name)]
      : name;
  devPayload[canonical] = value;
}

// 3c. Dev-specific overrides. SITE_URL must be the local origin so Better Auth
// trusts loopback in `getTrustedOrigins` (see src/lib/auth/config.ts).
devPayload.SITE_URL = "http://localhost:5173";
devPayload.PUBLIC_SITE_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// 4. Upload silently (or print a names-only plan in --dry-run).
// ---------------------------------------------------------------------------
const planNames = Object.keys(devPayload).sort();

if (dryRun) {
  console.log(`Dry run: would upload ${planNames.length} secrets to Doppler dev.`);
  console.log(`  Source files: ${sources.length > 0 ? sources.join(", ") : "(none)"}`);
  console.log(`  Reused from Doppler prd: ${Object.keys(prdSubset).sort().join(", ") || "(none)"}`);
  if (prdGaps.length > 0) {
    console.log(`  REUSE_FROM_PRD names missing in prd: ${prdGaps.join(", ")}`);
  }
  console.log("");
  console.log("Names that would be set in Doppler dev:");
  for (const n of planNames) console.log(`  + ${n}`);
} else {
  const tempPath = join(tmpdir(), `celstate-dev-bootstrap-${randomUUID()}.json`);
  writeFileSync(tempPath, JSON.stringify(devPayload), "utf8");
  try {
    chmodSync(tempPath, 0o600);
  } catch {
    /* best-effort on Windows */
  }
  try {
    const res = runDoppler(bin, ["secrets", "upload", tempPath, "--silent"], {
      project: "celstate",
      config: "dev",
    });
    if (res.status !== 0) {
      console.error(`doppler secrets upload failed: ${res.stderr.trim() || "unknown error"}`);
      process.exit(res.status ?? 1);
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
  }
  console.log(`Uploaded ${planNames.length} secrets to Doppler dev.`);
  console.log(`  Source files: ${sources.length > 0 ? sources.join(", ") : "(none)"}`);
  console.log(`  Reused from Doppler prd: ${Object.keys(prdSubset).sort().join(", ") || "(none)"}`);
  if (prdGaps.length > 0) {
    console.log(`  REUSE_FROM_PRD names missing in prd: ${prdGaps.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Highlight gaps the operator must still resolve manually.
// ---------------------------------------------------------------------------
const stillMissing = REQUIRED_FOR_DEV.filter((n) => !planNames.includes(n));
console.log("");
if (stillMissing.length > 0) {
  console.log(`Required dev names NOT covered by this bootstrap: ${stillMissing.length}`);
  for (const n of stillMissing) console.log(`  ! ${n}`);
  console.log("");
  console.log("Action items:");
  console.log("  - Add the missing names to Doppler dev (dashboard or `doppler secrets set`).");
  console.log("  - Then run `pnpm secrets:rotate:dev` and `pnpm secrets:sync:convex:dev`.");
} else {
  console.log("All required dev names covered (auto-rotatable secrets handled separately).");
  console.log("Next:");
  console.log("  1. `pnpm secrets:rotate:dev`");
  console.log("  2. `pnpm secrets:sync:convex:dev`");
}
